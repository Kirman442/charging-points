"""Export every branch, directional review section, and removed candidate."""
import csv,json
from prepare_motorways import ROOT

def export():
    source=ROOT/'data_sources/a5';zones=json.loads((source/'exit-zones.json').read_text())
    routes=json.loads((source/'routes.json').read_text())['routes']
    coords={(r['direction'],n):xy for r in routes for n,xy in zip(r['nodes'],r['coordinates'])}
    sections=[];features=[]
    for route in routes:
        direction=route['direction'];exits=sorted((e for e in zones['exits'] if e['direction']==direction),key=lambda e:e['chain_m'])
        bounds=[{'chain_m':0,'name':'Начало маршрута','node':None},*exits,{'chain_m':route['length_m'],'name':'Конец маршрута','node':None}]
        for a,b in zip(bounds,bounds[1:]):
            if a['chain_m']<b['chain_m']:
                sections.append({'direction':direction,'start_m':a['chain_m'],'end_m':b['chain_m'],
                                 'from_node':a['node'],'to_node':b['node'],'from_name':a['name'],'to_name':b['name']})
        for e in exits:
            features.append({'type':'Feature','geometry':{'type':'Point','coordinates':coords[direction,e['node']]},'properties':e})
    (source/'exit-sections.json').write_text(json.dumps(sections,ensure_ascii=False,indent=2))
    (source/'exits.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':')))
    with (source/'exits.csv').open('w',newline='',encoding='utf-8-sig') as f:
        fields=['direction','node','name','ref','kind','chain_m','motorway_junction_tag','way_ids']
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(zones['exits'])

if __name__=='__main__':export()
