"""Directed A5 exit zones. Every permitted branch is seeded, including rest areas.

The optimistic graph is diagnostic only: it supplies a distance lower bound,
never a permitted route. Unknown or missing paths are retained for review.
"""
import argparse,csv,gc,json
from pathlib import Path
from shapely.geometry import Point
from road_access_motorcar import Network,PROJECT
from a5_topology import build_routes
from prepare_motorways import ROOT,POLICY,sha

METHOD='a5-all-exits-road-zones-v1'

def elements_for_direction(elements, route, optimistic=False):
    selected=set(route['way_ids'])
    result=[]
    for o in elements:
        if optimistic and o['type']=='relation':continue
        tags=o.get('tags',{})
        if o['type']=='way':
            if o['id'] in selected:
                tags={**tags,'highway':'motorway'}
            elif tags.get('highway')=='motorway':
                # Preserve directions and permissions, but permit other motorway
                # carriageways as part of the access/return graph (e.g. A661).
                tags={**tags,'highway':'trunk','oneway':tags.get('oneway','yes')}
        if optimistic:
            tags={k:v for k,v in tags.items() if not k.endswith(':conditional') and k not in ('access','vehicle','motor_vehicle','motorcar','barrier')}
        result.append(o if tags==o.get('tags',{}) else {**o,'tags':tags})
    return result

def approach(network,point,context,max_access=3000,max_snap=200):
    if not len(network.projection_tree.geometries):return None
    closest=network.projection_tree.geometries[int(network.projection_tree.nearest(point))].distance(point)
    choices=[]
    for i in network.tree.query(point.buffer(max_snap)):
        i=int(i);edge=network.edges[i];snap=edge['line'].distance(point)
        if snap>max_snap or snap>closest+0.5 or i not in context['distances']:continue
        distance=context['distances'][i]+edge['line'].project(point)
        if distance<=max_access:choices.append((snap,distance,i))
    if not choices:return None
    snap,distance,i=min(choices);origin=context['origins'][i]
    return {'access_m':distance,'snap_m':snap,'exit_node':origin,'chain_m':context['chain'][origin]}

def exits(network,route,objects,node_tags,raw_ways):
    actual={}
    for wid in route['way_ids']:
        w=objects['way',wid];ns=w['nodes'][::-1] if w.get('tags',{}).get('oneway')=='-1' else w['nodes']
        for a,b in zip(ns,ns[1:]):actual[a,b]=wid
    output=[];chain=dict(zip(route['nodes'],route['chain']))
    for previous,node in zip(route['nodes'],route['nodes'][1:]):
        wid=actual.get((previous,node))
        if wid in network.review_ways:continue
        allowed=[network.edges[i] for i in network.outgoing[node]
                 if network.allowed(node,wid,network.edges[i]['way'],previous,network.edges[i]['v'])]
        if not allowed:continue
        ways=sorted({e['way'] for e in allowed});tags=node_tags.get(node,{})
        branch_tags=[raw_ways[w].get('tags',{}) for w in ways]
        destinations=list(dict.fromkeys(t.get('destination','') for t in branch_tags if t.get('destination')))
        rest=any('rest_area' in t.get('destination:symbol','') for t in branch_tags) or any(x in tags.get('name','').lower() for x in ['rast','parkplatz'])
        transfer=any('A ' in t.get('destination:ref','') for t in branch_tags)
        output.append({'direction':route['direction'],'node':node,'chain_m':chain[node],
            'name':tags.get('name') or '; '.join(destinations) or 'Ответвление без названия',
            'ref':tags.get('ref',''),'kind':'rest_area' if rest else 'motorway_transfer' if transfer else 'road_exit',
            'way_ids':ways,'motorway_junction_tag':tags.get('highway')=='motorway_junction'})
    return output

def refresh(path):
    source=ROOT/'data_sources/a5';audit=json.loads((source/'audit.json').read_text())
    if sha(path)!=audit['network_sha256']:raise ValueError('Unexpected road snapshot')
    payload=json.loads(path.read_text());routes,objects=build_routes(payload)
    raw_ways={o['id']:o for o in payload['elements'] if o['type']=='way'}
    selected={('way',i):objects['way',i] for r in routes for i in r['way_ids']}
    del objects;gc.collect()
    node_tags={o['id']:o.get('tags',{}) for o in json.loads((source/'core.json').read_text())['elements'] if o['type']=='node'}
    records=json.loads((source/'diagnostics.json').read_text());matches=[];inventory=[];result=[]
    for route in routes:
        direction=route['direction'];items=[r for r in records if r['direction']==direction]
        print('Conservative graph',direction,flush=True)
        network=Network(elements_for_direction(payload['elements'],route))
        ctx=network.search(route,selected,route['way_ids'],max_access=15000,max_return=15000)
        ee=exits(network,route,selected,node_tags,raw_ways);inventory.extend(ee);names={e['node']:e['name'] for e in ee}
        pending=[]
        for r in items:
            point=Point(PROJECT.transform(r['longitude'],r['latitude']))
            strict=network.match(point,ctx,max_access=3000,max_return=3000)
            extended=network.match(point,ctx,max_access=15000,max_return=15000)
            reached=approach(network,point,ctx,max_access=3000,max_snap=60)
            record={'direction':direction,'site_row':r['site_row'],'strict_link':strict,
                    'extended_link':extended,'permitted_approach_3km':reached,'optimistic_approach':None,
                    'status':'road_route_found_entrance_unverified' if strict else 'unconfirmed',
                    'review_reason':'' if strict else 'route_unconfirmed','review_detail':''}
            if strict:
                record['exit_name']=names.get(strict['exit_node'],'Ответвление без названия')
                matches.append({'direction':direction,'site_row':r['site_row'],**strict})
            else:pending.append((point,record))
            result.append(record)
        print(direction,'permitted exits',len(ee),'strict',sum(bool(r['strict_link']) for r in result if r['direction']==direction),flush=True)
        del network,ctx;gc.collect()
        print('Distance-bound graph',direction,flush=True)
        network=Network(elements_for_direction(payload['elements'],route,optimistic=True))
        ctx=network.search(route,selected,route['way_ids'],max_access=15000,max_return=3000)
        for point,r in pending:
            lower=approach(network,point,ctx,max_access=3000,max_snap=200) or approach(network,point,ctx,max_access=15000,max_snap=200)
            r['optimistic_approach']=lower
            if lower and lower['access_m']>3000:
                r['status']='distance_excluded';r['review_reason']='access_exceeds_3km_even_optimistic'
                r['review_detail']='Подъезд >3 км даже в диагностической сети без проверок доступа и поворотов; исключено только по модели OSM'
            elif r['permitted_approach_3km']:
                r['review_reason']='return_or_snap_unconfirmed'
                r['review_detail']='Подъезд ≤3 км найден; возврат ≤3 км на своё направление не подтверждён'
            elif lower:
                r['review_reason']='access_or_snap_review'
                r['review_detail']='Короткая связь появляется только в диагностике; проверить доступ, повороты, барьеры и привязку координаты'
            else:
                r['review_reason']='topology_or_coordinate_review'
                r['review_detail']='Связь не установлена: проверить координату, ближайшую дорогу и полноту OSM'
        del network,ctx;gc.collect()
    # Opposite directions are never used to promote a selected-direction site.
    strict_keys={(r['direction'],r['site_row']) for r in result if r['strict_link']}
    for r in result:
        other='south' if r['direction']=='north' else 'north'
        r['strict_opposite_direction']=(other,r['site_row']) in strict_keys
    report={'method':METHOD,'routing_policy':POLICY,'network_sha256':sha(path),
            'startup_sha256':audit['startup_sites_sha256'],'exits':inventory,'sites':result}
    (source/'exit-zones.json').write_text(json.dumps(report,ensure_ascii=False,separators=(',',':')))
    (source/'pilot-access-links.json').write_text(json.dumps({'method':METHOD,'routing_policy':POLICY,
        'network_sha256':sha(path),'matches':matches},separators=(',',':')))
    summary=[]
    for direction in ['north','south']:
        rr=[r for r in result if r['direction']==direction];ee=[e for e in inventory if e['direction']==direction]
        summary.append({'direction':direction,'exits':len(ee),'rest_area_exits':sum(e['kind']=='rest_area' for e in ee),
            'routed':sum(bool(r['strict_link']) for r in rr),'distance_excluded':sum(r['status']=='distance_excluded' for r in rr),
            'unresolved':sum(r['status']=='unconfirmed' for r in rr)})
    (source/'exit-zones-audit.json').write_text(json.dumps({'method':METHOD,'directions':summary,'entrances_verified':0},ensure_ascii=False,indent=2))
    print(json.dumps(summary),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--network',type=Path,required=True)
    refresh(parser.parse_args().network)
