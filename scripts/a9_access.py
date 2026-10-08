"""Conservative directed road routing. A nearby road is not a verified site entrance."""
import math
import heapq
from collections import defaultdict, Counter
from pyproj import Transformer
from shapely.geometry import LineString
from shapely.strtree import STRtree

PROJECT = Transformer.from_crs(4326, 32632, always_xy=True)

def permission(tags):
    return tags.get('motorcar',tags.get('motor_vehicle',tags.get('vehicle',tags.get('access','yes'))))


def forbidden_node(tags):
    if permission(tags) in ('no','private','agricultural','forestry'):return True
    if any(k.endswith(':conditional') for k in tags):return True
    barrier=tags.get('barrier')
    if barrier and barrier not in ('cattle_grid','toll_booth','border_control','entrance'):
        explicit=any(tags.get(k) in ('yes','permissive','designated') for k in ('motorcar','motor_vehicle','vehicle','access'))
        if not explicit:return True
    return False


class Network:
    def __init__(self,data):
        self.objects={(o['type'],o['id']):o for o in data}
        self.coords={o['id']:PROJECT.transform(o['lon'],o['lat']) for o in data if o['type']=='node'}
        self.blocked_nodes={o['id'] for o in data if o['type']=='node' and forbidden_node(o.get('tags',{}))}
        self.banned=defaultdict(list);self.only=defaultdict(set);self.review_ways=set();self.restriction_counts=Counter()
        for obj in data:
            if obj['type']!='relation':continue
            if obj.get('routing_review_required') or obj.get('incomplete_members'):
                self.review_ways.update(m['ref'] for m in obj.get('members',[]) if m['type']=='way')
                self.restriction_counts['incomplete_source_restriction']+=1
                continue
            tags=obj.get('tags',{});kind=tags.get('restriction:motorcar',tags.get('restriction:motor_vehicle',tags.get('restriction')))
            except_modes=set(tags.get('except','').split(';'))
            if except_modes & {'motorcar','motor_vehicle','vehicle'}:continue
            if not kind and not any(k.startswith('restriction') for k in tags):continue
            members=obj['members'];frm=[m['ref'] for m in members if m['role']=='from' and m['type']=='way'];to=[m['ref'] for m in members if m['role']=='to' and m['type']=='way'];via=[m['ref'] for m in members if m['role']=='via' and m['type']=='node']
            if not kind or any('conditional' in k for k in tags) or any(m['role']=='via' and m['type']=='way' for m in members) or len(via)!=1:
                self.review_ways.update(m['ref'] for m in members if m['type']=='way');self.restriction_counts['conservatively_excluded_complex']+=1;continue
            n=via[0]
            for f in frm:
                if kind.startswith('only_'):self.only[n,f].update(to)
                elif kind.startswith('no_'):
                    for t in to:self.banned[n,f].append((t,kind))
                else:self.review_ways.update(frm+to)
            self.restriction_counts['simple_node']+=1
        self.edges=[];self.outgoing=defaultdict(list);self.incoming=defaultdict(list);self.way_reasons=Counter();projection_lines=[]
        for way in data:
            if way['type']!='way':continue
            tags=way.get('tags',{});highway=tags.get('highway')
            if not highway or highway=='motorway':continue
            if highway not in ('motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','service','living_street','road'):continue
            projection=LineString([self.coords[n] for n in way['nodes']])
            if projection.length>0:projection_lines.append(projection)
            if permission(tags) in ('no','private','agricultural','forestry'):
                self.way_reasons['private_or_prohibited']+=1;continue
            if any(k.endswith(':conditional') for k in tags) or way['id'] in self.review_ways:
                self.way_reasons['conditional_or_complex_restriction']+=1;continue
            oneway=tags.get('oneway:motorcar',tags.get('oneway:motor_vehicle',tags.get('oneway')))
            ns=way['nodes'][::-1] if oneway=='-1' else way['nodes']
            directed=oneway in ('yes','1','true','-1') or (oneway not in ('no','0','false') and tags.get('junction')=='roundabout')
            for u,v in zip(ns,ns[1:]):
                if u not in self.coords or v not in self.coords:raise ValueError('Incomplete driving way geometry')
                if u in self.blocked_nodes or v in self.blocked_nodes:continue
                self.add_edge(u,v,way['id'])
                if not directed:self.add_edge(v,u,way['id'])
        self.tree=STRtree([e['line'] for e in self.edges])
        self.projection_tree=STRtree(projection_lines)

    def add_edge(self,u,v,way):
        line=LineString([self.coords[u],self.coords[v]])
        if line.length<=0:return
        index=len(self.edges);self.edges.append({'u':u,'v':v,'way':way,'length':line.length,'line':line})
        self.outgoing[u].append(index);self.incoming[v].append(index)

    def allowed(self,node,from_way,to_way,prev_node,next_node):
        if from_way is None or to_way is None:return True
        required=self.only.get((node,from_way))
        if required and to_way not in required:return False
        for target,kind in self.banned.get((node,from_way),[]):
            if target!=to_way:continue
            if kind=='no_u_turn' and from_way==to_way and prev_node!=next_node:continue
            return False
        return True

    def search(self,route,route_objects,route_ids):
        chain=dict(zip(route['nodes'],route['chain']));actual={}
        for wid in set(route_ids):
            way=route_objects['way',wid]
            ns=way['nodes'][::-1] if way.get('tags',{}).get('oneway')=='-1' else way['nodes']
            for a,b in zip(ns,ns[1:]):actual[a,b]=wid
        previous={n:(p,actual.get((p,n))) for p,n in zip(route['nodes'],route['nodes'][1:])}
        following={n:(p,actual.get((n,p))) for n,p in zip(route['nodes'],route['nodes'][1:])}
        distances={};origins={};parent={};heap=[];exit_nodes=set();entry_nodes=set()
        for node in route['nodes']:
            if node not in previous:continue
            p,wid=previous[node]
            if wid in self.review_ways:continue
            for index in self.outgoing[node]:
                e=self.edges[index]
                if self.allowed(node,wid,e['way'],p,e['v']):
                    distances[index]=0.;origins[index]=node;parent[index]=None;heapq.heappush(heap,(0.,index));exit_nodes.add(node)
        while heap:
            d,index=heapq.heappop(heap)
            if d!=distances.get(index):continue
            edge=self.edges[index];cost=d+edge['length']
            if cost>3000:continue
            for nxt in self.outgoing[edge['v']]:
                other=self.edges[nxt]
                if not self.allowed(edge['v'],edge['way'],other['way'],edge['u'],other['v']):continue
                if cost<distances.get(nxt,math.inf):
                    distances[nxt]=cost;origins[nxt]=origins[index];parent[nxt]=index;heapq.heappush(heap,(cost,nxt))
        returns={};return_child={};return_nodes={};heap=[]
        for node in route['nodes']:
            if node not in following:continue
            nxt,wid=following[node]
            if wid in self.review_ways:continue
            for index in self.incoming[node]:
                e=self.edges[index]
                if self.allowed(node,e['way'],wid,e['u'],nxt):
                    returns[index]=0.;return_child[index]=None;return_nodes[index]=node;heapq.heappush(heap,(0.,index));entry_nodes.add(node)
        while heap:
            d,index=heapq.heappop(heap)
            if d!=returns.get(index):continue
            edge=self.edges[index];cost=d+edge['length']
            if cost>3000:continue
            for prev in self.incoming[edge['u']]:
                other=self.edges[prev]
                if not self.allowed(edge['u'],other['way'],edge['way'],other['u'],edge['v']):continue
                if cost<returns.get(prev,math.inf):
                    returns[prev]=cost;return_child[prev]=index;return_nodes[prev]=return_nodes[index];heapq.heappush(heap,(cost,prev))
        return {'distances':distances,'origins':origins,'parents':parent,'returns':returns,'return_children':return_child,'return_nodes':return_nodes,'chain':chain,'exit_nodes':len(exit_nodes),'entry_nodes':len(entry_nodes)}

    def match(self,point,context,max_snap=60):
        choices=[]
        nearby=[int(i) for i in self.tree.query(point.buffer(max_snap))]
        closest=self.projection_tree.geometries[int(self.projection_tree.nearest(point))].distance(point)
        for index in nearby:
            index=int(index);edge=self.edges[index];snap=edge['line'].distance(point)
            if snap>max_snap or snap>closest+0.5 or index not in context['distances'] or index not in context['returns']:continue
            along=edge['line'].project(point);access=context['distances'][index]+along
            # Model a pull-in/pull-out to the same oriented road edge. Actual entrances still unknown.
            back=context['returns'][index]+edge['length']-along
            if access<=3000 and back<=3000:
                choices.append((snap,access,back,index))
        if not choices:return None
        snap,access,back,index=min(choices)
        origin=context['origins'][index]
        arrival=[];cur=index
        while cur is not None:arrival.append(cur);cur=context['parents'][cur]
        arrival.reverse();departure=[];cur=index
        while cur is not None:departure.append(cur);cur=context['return_children'][cur]
        def ways(path):return list(dict.fromkeys(self.edges[i]['way'] for i in path))
        return {'access_m':round(access,1),'return_m':round(back,1),'snap_m':round(snap,1),
                'chain_m':context['chain'][origin],'exit_node':origin,'entry_node':context['return_nodes'][index],
                'arrival_ways':ways(arrival),'departure_ways':ways(departure),'nearby_way':self.edges[index]['way']}

