"""Build four audited A1 carriageway paths. Never connect the real Eifel gap."""
import json,math,hashlib
from pathlib import Path
import networkx as nx
from pyproj import Transformer
from shapely.geometry import LineString
ROOT=Path(__file__).resolve().parents[1] / 'data_sources/a1'
PROJECT=Transformer.from_crs(4326,32632,always_xy=True)
UNPROJECT=Transformer.from_crs(32632,4326,always_xy=True)

def build():
    raw=json.loads((ROOT/'core.json').read_text())['elements']
    objects={(o['type'],o['id']):o for o in raw};selection=json.loads((ROOT/'selection.json').read_text());graph=nx.DiGraph()
    for wid in selection['selected_way_ids']:
        w=objects['way',wid];ns=w['nodes']
        if w['tags'].get('oneway')!='yes':raise ValueError('Unexpected undirected main carriageway')
        for a,b in zip(ns,ns[1:]):graph.add_edge(a,b,way_id=wid)
    paths=[]
    for component in nx.weakly_connected_components(graph):
        sub=graph.subgraph(component);starts=[n for n in sub if sub.in_degree(n)==0]
        if len(starts)!=1 or any(sub.in_degree(n)>1 or sub.out_degree(n)>1 for n in sub):raise ValueError('Unresolved A1 topology')
        path=[starts[0]]
        while sub.out_degree(path[-1]):path.append(next(iter(sub.successors(path[-1]))))
        if len(path)!=len(component):raise ValueError('Cycle/incomplete traversal')
        # At the Blankenheim terminal OSM joins the two carriageways at this shared node.
        # Split the U-shaped terminal traversal into actual driving directions.
        terminal=1359941472
        if terminal in path:
            i=path.index(terminal);paths.extend([path[:i+1],path[i:]])
        else:paths.append(path)
    routes=[]
    for nodes in paths:
        coordinates=[(objects['node',n]['lon'],objects['node',n]['lat']) for n in nodes]
        xy=[PROJECT.transform(*p) for p in coordinates];chain=[0.]
        for a,b in zip(xy,xy[1:]):chain.append(chain[-1]+math.dist(a,b))
        direction='north' if coordinates[-1][1]>coordinates[0][1] else 'south'
        section='northern' if max(p[1] for p in coordinates)>54 else 'southern'
        way_ids=sorted({graph[a][b]['way_id'] for a,b in zip(nodes,nodes[1:])})
        routes.append({'direction':direction,'section':section,'nodes':nodes,'coordinates':coordinates,'chain':chain,'length_m':chain[-1],'way_ids':way_ids})
    routes.sort(key=lambda r:(r['section'],r['direction']))
    if len(routes)!=4 or len({(r['section'],r['direction']) for r in routes})!=4:raise ValueError('Expected 2 sections x 2 directions')
    return routes,objects,selection

if __name__=='__main__':
    routes,objects,selection=build()
    features=[{'type':'Feature','properties':{'route':'A 1','section':r['section'],'direction':r['direction'],'length_km':round(r['length_m']/1000,3)},'geometry':{'type':'LineString','coordinates':r['coordinates']}} for r in routes]
    (ROOT/'routes.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')))
    (ROOT/'routes.json').write_text(json.dumps({'routes':routes},separators=(',',':')))
    print(json.dumps([f['properties'] for f in features],ensure_ascii=False,indent=2))
