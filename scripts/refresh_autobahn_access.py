"""Directional exit-zone analysis with local graphs covering every <=15 km path.

Graph windows include the candidate envelope plus 16 km on every side. They contain
all possible <=15 km paths to/from the site, including a <=200 m road snap.
All original route nodes are seeds, including branches without junction tags.
"""
import argparse,csv,gc,hashlib,json,math
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq
from shapely.geometry import Point,LineString
from shapely.ops import substring
from road_network_store import RoadStore,index,sha,log
from road_access_motorcar import Network,PROJECT
from a5_exit_zones import elements_for_direction,approach,exits
from prepare_motorways import routes_for,intervals,POLICY
from prepare_a9 import read_objects,relation_ways,equipment_stats,UNPROJECT

ROOT=Path(__file__).resolve().parents[1]
METHOD='all-exits-road-zones-v1'
TILE=30000
MARGIN=16000


def runtime_binding(data):
    startup_hash=sha(data/'charging_sites_startup_zstd10.parquet')
    groups_hash=sha(data/'charging_point_groups_numeric_zstd10.parquet')
    catalog=pq.read_schema(data/'charging_runtime_catalog_zstd10.parquet').metadata
    if catalog.get(b'startup_sites_sha256')!=startup_hash.encode() or catalog.get(b'numeric_groups_sha256')!=groups_hash.encode():
        raise ValueError('Runtime inputs do not match catalog')
    return {'startup_sha256':startup_hash,'groups_sha256':groups_hash}


def route_fingerprint(routes):
    return hashlib.sha256(json.dumps([{k:r.get(k) for k in ('direction','section','nodes','coordinates','way_ids')} for r in routes],sort_keys=True,separators=(',',':')).encode()).hexdigest()


def current_routes(route,store):
    templates=routes_for(route)
    if route=='A1':
        ids={wid for r in templates for wid in r['way_ids']}
    else:
        cached=read_objects(ROOT/'data_sources/a9')
        ids=set(relation_ways(cached,20738))|{725303216,725303217}
        del cached
    ways=store.ways(ids)
    missing=ids-set(ways)
    # Route relations can contain motorway links irrelevant to the main path.
    nodes=store.nodes({n for r in templates for n in r['nodes']})
    graph={}
    for wid,w in ways.items():
        tags=w.get('tags',{})
        if tags.get('highway')!='motorway':continue
        if tags.get('oneway') not in ('yes','1','true','-1'):raise ValueError(f'Undirected core way {wid}')
        ns=w['nodes'][::-1] if tags['oneway']=='-1' else w['nodes']
        for a,b in zip(ns,ns[1:]):graph[a,b]=wid
    selected={}
    for r in templates:
        pairs=list(zip(r['nodes'],r['nodes'][1:]))
        absent=[(a,b) for a,b in pairs if (a,b) not in graph]
        if absent:raise ValueError(f'PBF main-route topology differs from audited path: {route} {r.get("section")} {r["direction"]}; {absent[:5]}')
        if any(n not in nodes for n in r['nodes']):raise ValueError('Missing main-route coordinates')
        coordinates=[(nodes[n]['lon'],nodes[n]['lat']) for n in r['nodes']]
        metric=[PROJECT.transform(*p) for p in coordinates];chain=[0.]
        for a,b in zip(metric,metric[1:]):chain.append(chain[-1]+math.dist(a,b))
        r.update(coordinates=coordinates,line=LineString(metric),chain=chain,length_m=chain[-1],way_ids=list(dict.fromkeys(graph[p] for p in pairs)))
        selected.update((('way',wid),ways[wid]) for wid in r['way_ids'])
    return templates,selected,{'unused_relation_way_ids_absent':sorted(missing),'all_main_path_edges_verified_in_pbf':True}


def candidates(routes):
    startup=pq.read_table(ROOT/'public/data/charging_sites_startup_zstd10.parquet')
    groups=pq.read_table(ROOT/'public/data/charging_point_groups_numeric_zstd10.parquet')
    powers,fast=equipment_stats(groups,startup.num_rows)
    positions=list(zip(startup['longitude'].to_pylist(),startup['latitude'].to_pylist()))
    points=[Point(PROJECT.transform(*p)) for p in positions]
    result=[]
    for r in routes:
        for row,point in enumerate(points):
            if r['line'].distance(point)>3500:continue
            lon,lat=positions[row]
            result.append({'direction':r['direction'],'section':r.get('section'),'site_row':row,'longitude':lon,'latitude':lat,
                'chain_m':r['line'].project(point),'power_kw':powers[row],'fast_points':fast[row],
                'eligible_power':powers[row]>=400 and fast[row]>0,'tile':[math.floor(point.x/TILE),math.floor(point.y/TILE)]})
    keys=[(r['direction'],r['site_row']) for r in result]
    if len(set(keys))!=len(keys):raise ValueError('Candidate belongs to multiple same-direction sections; manual review required')
    return result


def refresh(route,network_path,index_path):
    index(network_path,index_path)
    store=RoadStore(index_path)
    routes,selected,topology=current_routes(route,store)
    binding={**runtime_binding(ROOT/'public/data'),'route_paths_sha256':route_fingerprint(routes)}
    audit_path=network_path.parent/'pbf-extraction-audit.json'
    source_audit=json.loads(audit_path.read_text()) if audit_path.exists() else None
    if source_audit and source_audit['route']!=route:raise ValueError('Road source audit belongs to another motorway')
    if source_audit:
        counts=json.loads(store.db.execute("SELECT value FROM meta WHERE key='counts'").fetchone()[0])
        if counts!=source_audit['counts']:raise ValueError('Road source counts do not match extraction audit')
    quarantined=[json.loads(body) for body, in store.db.execute("SELECT body FROM r WHERE body LIKE '%\"routing_review_required\":true%'")]
    safety={'incomplete_restriction_ids':[o['id'] for o in quarantined],
            'blocked_member_way_ids':sorted({m['ref'] for o in quarantined for m in o['members'] if m['type']=='way'}),
            'policy':'block_member_ways_in_strict_graph'}
    records=candidates(routes)
    source=ROOT/'data_sources'/route.lower();source.mkdir(exist_ok=True)
    network_hash=sha(network_path);startup_hash=binding['startup_sha256']
    output=source/'exit-zone-checkpoints';output.mkdir(exist_ok=True)
    tiles=sorted({tuple(r['tile']) for r in records});all_results=[];inventory={}
    for i,tile in enumerate(tiles):
        file=output/f'{tile[0]}_{tile[1]}.json'
        if file.exists():
            cached=json.loads(file.read_text())
            if cached['network_sha256']!=network_hash or cached['startup_sha256']!=startup_hash or cached['method']!=METHOD or cached.get('input_binding')!=binding:raise ValueError('Stale tile checkpoint; use fresh checkpoint directory')
            all_results.extend(cached['sites'])
            for e in cached['exits']:inventory[e['direction'],e.get('section'),e['node']]=e
            log(f'{route} tile {i+1}/{len(tiles)}: reused checkpoint');continue
        log(f'{route} tile {i+1}/{len(tiles)}: loading {tile}')
        tile_records=[item for item in records if tuple(item['tile'])==tile]
        positions=[PROJECT.transform(item['longitude'],item['latitude']) for item in tile_records]
        xx,yy=zip(*positions)
        bounds=(min(xx)-MARGIN,min(yy)-MARGIN,max(xx)+MARGIN,max(yy)+MARGIN)
        elements=store.tile(bounds)
        rawways={o['id']:o for o in elements if o['type']=='way'}
        node_tags={o['id']:o.get('tags',{}) for o in elements if o['type']=='node'}
        tile_results=[];tile_exits=[]
        for r in routes:
            items=[item for item in tile_records if item['direction']==r['direction'] and item.get('section')==r.get('section')]
            if not items:continue
            log(f'{route} {r.get("section", "")} {r["direction"]}: strict graph ({len(rawways)} ways), {len(items)} candidates')
            network=Network(elements_for_direction(elements,r))
            ctx=network.search(r,selected,r['way_ids'],max_access=15000,max_return=15000)
            ee=exits(network,r,selected,node_tags,rawways)
            for e in ee:e['section']=r.get('section');inventory[e['direction'],e.get('section'),e['node']]=e
            tile_exits.extend(ee);names={e['node']:e['name'] for e in ee};pending=[]
            for item in items:
                point=Point(PROJECT.transform(item['longitude'],item['latitude']))
                strict=network.match(point,ctx,max_access=3000,max_return=3000)
                extended=network.match(point,ctx,max_access=15000,max_return=15000)
                reached=approach(network,point,ctx,max_access=3000,max_snap=60)
                record={**item,'strict_link':strict,'extended_link':extended,'permitted_approach_3km':reached,'optimistic_approach':None,
                    'status':'road_route_found_entrance_unverified' if strict else 'unconfirmed','review_reason':'' if strict else 'route_unconfirmed','review_detail':''}
                if strict:record['exit_name']=names.get(strict['exit_node'],'Ответвление без названия')
                else:pending.append((point,record))
                tile_results.append(record)
            del network,ctx;gc.collect()
            if pending:
                log(f'{route} {r["direction"]}: diagnostic graph, {len(pending)} unresolved')
                network=Network(elements_for_direction(elements,r,optimistic=True))
                ctx=network.search(r,selected,r['way_ids'],max_access=15000,max_return=3000)
                for point,record in pending:
                    lower=approach(network,point,ctx,max_access=3000,max_snap=200) or approach(network,point,ctx,max_access=15000,max_snap=200)
                    record['optimistic_approach']=lower
                    if lower and lower['access_m']>3000:
                        record.update(status='distance_excluded',review_reason='access_exceeds_3km_even_optimistic',review_detail='Подъезд >3 км даже в диагностической сети без проверок доступа и поворотов; исключено только по модели OSM')
                    elif record['permitted_approach_3km']:
                        record.update(review_reason='return_or_snap_unconfirmed',review_detail='Подъезд ≤3 км найден; возврат ≤3 км на своё направление не подтверждён')
                    elif lower:
                        record.update(review_reason='access_or_snap_review',review_detail='Короткая связь появляется только в диагностике; проверить доступ, повороты, барьеры и привязку координаты')
                    else:
                        record.update(review_reason='topology_or_coordinate_review',review_detail='Связь не установлена: проверить координату, ближайшую дорогу и полноту OSM')
                del network,ctx;gc.collect()
        tmp=file.with_suffix('.part')
        tmp.write_text(json.dumps({'method':METHOD,'network_sha256':network_hash,'startup_sha256':startup_hash,'input_binding':binding,'sites':tile_results,'exits':tile_exits},ensure_ascii=False,separators=(',',':')))
        tmp.replace(file);all_results.extend(tile_results)
        log(f'{route} tile {i+1}/{len(tiles)}: checkpoint saved')
        del elements,rawways,node_tags;gc.collect()
    strict_keys={(r['direction'],r['site_row']) for r in all_results if r['strict_link']}
    if len(all_results)!=len(records):raise ValueError('Incomplete candidate results')
    if {(s['direction'],s.get('section'),s['site_row']) for s in all_results}!={(s['direction'],s.get('section'),s['site_row']) for s in records}:raise ValueError('Candidate checkpoint membership mismatch')
    blocked=set(safety['blocked_member_way_ids'])
    for s in all_results:
        link=s['strict_link']
        if link and blocked.intersection(link['arrival_ways']+link['departure_ways']):raise ValueError('Strict route uses quarantined restriction member')
    safety['strict_paths_checked_against_blocked_members']=len(strict_keys)
    for r in all_results:r['strict_opposite_direction']=('south' if r['direction']=='north' else 'north',r['site_row']) in strict_keys
    report={'method':METHOD,'routing_policy':POLICY,'network_sha256':network_hash,'startup_sha256':startup_hash,'input_binding':binding,
            'source_audit':source_audit,'restriction_safety':safety,
            'topology':topology,'graph_window':{'tile_m':TILE,'margin_m':MARGIN,'max_diagnostic_path_m':15000,'window':'candidate_envelope; earlier checkpoints may use whole tile'},
            'exit_inventory_scope':'candidate_windows; every route node is a search seed',
            'exits':list(inventory.values()),'sites':all_results}
    (source/'exit-zones.json').write_text(json.dumps(report,ensure_ascii=False,separators=(',',':')))
    export(route,routes,report)
    store.db.close()


def export(route,routes,report):
    rows=[];parts=[];site_rows=[]
    for r in routes:
        items=[s for s in report['sites'] if s['direction']==r['direction'] and s.get('section')==r.get('section')]
        chain=dict(zip(r['nodes'],r['chain']));sites=[]
        for item in items:
            link=item['strict_link'] or item['extended_link']
            site=dict(kind='site',direction=r['direction'],section=r.get('section'),site_row=item['site_row'],
                geometry_json=json.dumps([item['longitude'],item['latitude']]),chain_m=item['chain_m'],
                status=item['status'],power_kw=item['power_kw'],fast_points=item['fast_points'],eligible_power=item['eligible_power'],
                access_m=link['access_m'] if link else None,return_m=link['return_m'] if link else None,snap_m=link['snap_m'] if link else None,
                entry_chain_m=chain[link['entry_node']] if link else None,review_reason=item['review_reason'],review_detail=item['review_detail'],
                exit_name=item.get('exit_name'),exit_node=link['exit_node'] if link else None,entry_node=link['entry_node'] if link else None,
                diagnostic_access_m=(item['optimistic_approach'] or {}).get('access_m'),end_m=None,gap_km=None,road_gap_km=None)
            if link:site['chain_m']=link['chain_m']
            sites.append(site)
        gaps=intervals(r['line'].length,sites)
        for a,b,status,gap in gaps:
            segment={k:None for k in sites[0]} if sites else {}
            segment.update(kind='segment',direction=r['direction'],section=r.get('section'),site_row=None,
                geometry_json=json.dumps([UNPROJECT.transform(*p) for p in substring(r['line'],a,b).coords]),chain_m=a,end_m=b,status=status,gap_km=gap,road_gap_km=(b-a)/1000)
            rows.append(segment)
        rows.extend(sites);site_rows.extend(sites)
        routed=[s for s in sites if s['status']=='road_route_found_entrance_unverified'];known=[gap for _,_,status,gap in gaps if status!='unknown']
        parts.append(dict(direction=r['direction'],section=r.get('section'),length_km=round(r['line'].length/1000,3),candidates=len(sites),routed=len(routed),fast_routed=sum(s['fast_points']>0 for s in routed),eligible_routed=sum(s['eligible_power'] for s in routed),distance_excluded=sum(s['status']=='distance_excluded' for s in sites),unresolved=sum(s['status']=='unconfirmed' for s in sites),max_gap_km=round(max(known),1) if known else None,unknown_segments=sum(status=='unknown' for _,_,status,_ in gaps),verified_entrances=0))
    summary=[]
    for direction in ['north','south']:
        pp=[p for p in parts if p['direction']==direction];result={'direction':direction}
        for key in ['length_km','candidates','routed','fast_routed','eligible_routed','distance_excluded','unresolved','unknown_segments','verified_entrances']:result[key]=sum(p[key] for p in pp)
        result['length_km']=round(result['length_km'],2);result['active_candidates']=result['candidates']-result['distance_excluded'];result['max_gap_km']=max((p['max_gap_km'] for p in pp if p['max_gap_km'] is not None),default=None);summary.append(result)
    metadata={'format':'autobahn-pilot-v2','route':route,'startup_sites_sha256':report['startup_sha256'],'site_count':str(pq.read_metadata(ROOT/'public/data/charging_sites_startup_zstd10.parquet').num_rows),'source_date':'2026-09-01','access_network':'true','access_network_sha256':report['network_sha256'],'routing_policy':POLICY,'interval_method':'return-road-approach-v1','directions':json.dumps(summary),'sections':json.dumps(parts) if route=='A1' else 'null','candidate_method':METHOD,'exits':json.dumps(report['exits'],ensure_ascii=False),'assessment':'exploratory-not-legal-compliance','network_source':json.dumps(report.get('source_audit')),'restriction_safety':json.dumps(report.get('restriction_safety'))}
    metadata['input_binding']=json.dumps(report.get('input_binding'))
    dates=pq.read_table(ROOT/'public/data/charging_sites_startup_zstd10.parquet',columns=['source_date'])['source_date'].unique().to_pylist()
    if len(dates)!=1:raise ValueError('Expected a single charging registry source date')
    metadata['source_date']=str(dates[0])
    table=pa.Table.from_pylist(rows)
    table=table.cast(pa.schema([(field.name,{'site_row':pa.uint32(),'fast_points':pa.uint32(),'exit_node':pa.float64(),'entry_node':pa.float64()}.get(field.name,field.type)) for field in table.schema]))
    table=table.replace_schema_metadata({k.encode():v.encode() for k,v in metadata.items()})
    destination=ROOT/f'public/data/autobahn_{route.lower()}_zstd10.parquet'
    temporary=destination.with_suffix('.part.parquet')
    pq.write_table(table,temporary,compression='zstd',compression_level=10)
    if not pq.read_table(temporary).equals(table):raise ValueError('Parquet round trip mismatch')
    temporary.replace(destination)
    source=ROOT/'data_sources'/route.lower();audit={'route':route,'method':METHOD,'directions':summary,'sections':parts,'topology':report['topology'],'graph_window':report['graph_window'],'network_sha256':report['network_sha256'],'source_audit':report.get('source_audit'),'restriction_safety':report.get('restriction_safety'),'exit_inventory_scope':report.get('exit_inventory_scope'),'entrances_verified':0}
    audit['input_binding']=report.get('input_binding')
    (source/'pilot-3km-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
    with (source/'pilot-3km-site-review.csv').open('w',newline='',encoding='utf-8-sig') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(site_rows[0]));writer.writeheader();writer.writerows(site_rows)
    log(json.dumps(summary,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--route',choices=['A1','A9'],required=True);parser.add_argument('--network',type=Path,required=True);parser.add_argument('--index',type=Path,required=True);args=parser.parse_args()
    refresh(args.route,args.network,args.index)
