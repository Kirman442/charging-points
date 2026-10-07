import math,re
import networkx as nx
from shapely.geometry import LineString
from road_access_motorcar import PROJECT,permission

def build_routes(payload):
 objects={(o['type'],o['id']):o for o in payload['elements']};graph=nx.DiGraph()
 for o in payload['elements']:
  if o['type']!='way':continue
  tags=o.get('tags',{});h=tags.get('highway');ns=o['nodes']
  if h not in ('motorway','motorway_link') or permission(tags) in ('no','private'):continue
  core=h=='motorway' and re.search(r'(^|;)\s*A\s*5\s*(;|$)',tags.get('ref',''))
  junction=any(8.57<=objects['node',n]['lon']<=8.63 and 49.84<=objects['node',n]['lat']<=49.88 for n in ns)
  if not(core or junction):continue
  if tags.get('oneway')=='-1':ns=ns[::-1]
  if tags.get('oneway') not in ('yes','1','true','-1'):continue
  for a,b in zip(ns,ns[1:]):
   aa=objects['node',a];bb=objects['node',b];length=math.dist(PROJECT.transform(aa['lon'],aa['lat']),PROJECT.transform(bb['lon'],bb['lat']))
   graph.add_edge(a,b,weight=length,way_id=o['id'])
 routes=[]
 for direction,start,end in [('north',13424209801,481675),('south',1595591692,13424209901)]:
  ns=nx.shortest_path(graph,start,end,weight='weight')
  xy=[(objects['node',n]['lon'],objects['node',n]['lat']) for n in ns]
  metric=[PROJECT.transform(*p) for p in xy];chain=[0.]
  for a,b in zip(metric,metric[1:]):chain.append(chain[-1]+math.dist(a,b))
  ways=list(dict.fromkeys(graph[a][b]['way_id'] for a,b in zip(ns,ns[1:])))
  routes.append({'direction':direction,'nodes':ns,'chain':chain,'coordinates':xy,'length_m':chain[-1],'way_ids':ways,'line':LineString(metric)})
 return routes,objects

