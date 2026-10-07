"""Re-search the complete A5 graph under the shared 3/3 km pilot policy."""
import argparse,gc,json
from pathlib import Path
from shapely.geometry import Point
from a5_topology import build_routes
from road_access_motorcar import Network,PROJECT
from prepare_motorways import ROOT,POLICY,sha

def refresh(path):
    source=ROOT/'data_sources/a5'
    audit=json.loads((source/'audit.json').read_text())
    if sha(path)!=audit['network_sha256']:
        raise ValueError('Unexpected A5 network')
    payload=json.loads(path.read_text());routes,objects=build_routes(payload)
    main_links={i for r in routes for i in r['way_ids'] if objects['way',i]['tags'].get('highway')=='motorway_link'}
    selected={('way',i):objects['way',i] for r in routes for i in r['way_ids']}
    del objects;gc.collect()
    elements=[{**o,'tags':{**o.get('tags',{}),'highway':'motorway'}} if o['type']=='way' and o['id'] in main_links else o for o in payload['elements']]
    print('Building A5 network',flush=True);network=Network(elements)
    records=json.loads((source/'diagnostics.json').read_text());matches=[]
    for route in routes:
        print('Searching',route['direction'],flush=True)
        ctx=network.search(route,selected,route['way_ids'],max_access=3000,max_return=3000)
        for record in records:
            if record['direction']!=route['direction']:continue
            point=Point(PROJECT.transform(record['longitude'],record['latitude']))
            match=network.match(point,ctx,max_access=3000,max_return=3000)
            if match:matches.append({'direction':route['direction'],'site_row':record['site_row'],**match})
        print(route['direction'],sum(m['direction']==route['direction'] for m in matches),flush=True)
        del ctx;gc.collect()
    (source/'pilot-access-links.json').write_text(json.dumps({'routing_policy':POLICY,
        'network_sha256':sha(path),'matches':matches},separators=(',',':')))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--network',type=Path,required=True)
    refresh(parser.parse_args().network)
