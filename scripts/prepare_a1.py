"""Prepare disconnected A1 sections with numeric road links; no browser spatial joins."""
import argparse,json,hashlib,csv
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq
from shapely.geometry import Point,LineString
from shapely.ops import substring
from a1_topology import build,PROJECT,UNPROJECT
from a9_access import Network
from prepare_a9 import equipment_stats,gaps,sha
ROOT=Path(__file__).resolve().parents[1]

def prepare(network_path=None):
    source=ROOT/'data_sources/a1';data=ROOT/'public/data'
    routes,objects,selection=build()
    for r in routes:r['line']=LineString([PROJECT.transform(*xy) for xy in r['coordinates']])
    sites_path=data/'charging_sites_startup_zstd10.parquet';groups_path=data/'charging_point_groups_numeric_zstd10.parquet'
    catalog=pq.read_table(data/'charging_runtime_catalog_zstd10.parquet').schema.metadata
    if catalog[b'startup_sites_sha256'].decode()!=sha(sites_path) or catalog[b'numeric_groups_sha256'].decode()!=sha(groups_path):raise ValueError('Runtime catalog mismatch')
    sites=pq.read_table(sites_path);coords=list(zip(sites['longitude'].to_pylist(),sites['latitude'].to_pylist()))
    power,fast=equipment_stats(pq.read_table(groups_path),sites.num_rows)
    binding={'startup_sha256':sha(sites_path),'groups_sha256':sha(groups_path),'routes_sha256':hashlib.sha256(json.dumps([{k:v for k,v in r.items() if k!='line'} for r in routes],sort_keys=True).encode()).hexdigest()}
    cache_path=source/'access-links.json'
    if network_path:
        payload=json.loads(network_path.read_text());network=Network(payload['elements'])
        if {n for r in routes for n in r['nodes']}-network.coords.keys():raise ValueError('Network missing route nodes')
        matches=[]
        for route in routes:
            context=network.search(route,objects,route['way_ids'])
            for row,xy in enumerate(coords):
                point=Point(PROJECT.transform(*xy))
                if route['line'].distance(point)>3500:continue
                match=network.match(point,context)
                if match:matches.append({'section':route['section'],'direction':route['direction'],'site_row':row,**match})
            print('Road links',route['section'],route['direction'],len([m for m in matches if m['section']==route['section'] and m['direction']==route['direction']]),flush=True)
        cache={'format':'a1-access-links-v1','binding':binding,'matches':matches,'source':payload['source'],'network_sha256':sha(network_path),'restrictions':dict(network.restriction_counts)}
        cache_path.write_text(json.dumps(cache,ensure_ascii=False,indent=2)+'\n')
    else:
        cache=json.loads(cache_path.read_text())
        if cache['format']!='a1-access-links-v1' or cache['binding']!=binding:raise ValueError('Stale A1 road links: recompute with --network')
    links={};lengths={(r['section'],r['direction']):r['length_m'] for r in routes}
    for m in cache['matches']:
        key=m['section'],m['direction'],m['site_row']
        if key in links or key[:2] not in lengths or not isinstance(m['site_row'],int) or not 0<=m['site_row']<sites.num_rows or not 0<=m['access_m']<=3000 or not 0<=m['return_m']<=10000 or not 0<=m['snap_m']<=60 or not 0<=m['chain_m']<=lengths[key[:2]]:raise ValueError('Invalid checked link')
        links[key]=m
    rows=[];parts=[];review=[]
    for route in routes:
        section,direction,line=route['section'],route['direction'],route['line'];candidates=[]
        for row,xy in enumerate(coords):
            point=Point(PROJECT.transform(*xy))
            if line.distance(point)>3500:continue
            match=links.get((section,direction,row));chain=match['chain_m'] if match else line.project(point)
            c={'kind':'site','direction':direction,'section':section,'site_row':row,'geometry_json':json.dumps(xy),'chain_m':chain,'end_m':None,'gap_km':None,'status':'road_route_found_entrance_unverified' if match else 'unconfirmed','power_kw':power[row],'fast_points':fast[row],'eligible_power':power[row]>=400 and fast[row]>0,'access_m':match['access_m'] if match else None,'return_m':match['return_m'] if match else None,'snap_m':match['snap_m'] if match else None}
            candidates.append(c)
        intervals=gaps(line.length,[{**c,'access_status':c['status']} for c in candidates])
        for a,b,status in intervals:
            xy=[UNPROJECT.transform(*p) for p in substring(line,a,b).coords]
            rows.append({'kind':'segment','direction':direction,'section':section,'site_row':None,'geometry_json':json.dumps(xy,separators=(',',':')),'chain_m':a,'end_m':b,'gap_km':(b-a)/1000,'status':status,'power_kw':None,'fast_points':None,'eligible_power':None,'access_m':None,'return_m':None,'snap_m':None})
        rows.extend(candidates);review.extend(candidates)
        routed=[c for c in candidates if c['status']=='road_route_found_entrance_unverified']
        known=[b-a for a,b,status in intervals if status!='unknown']
        parts.append({'section':section,'direction':direction,'length_km':round(line.length/1000,3),'candidates':len(candidates),'routed':len(routed),'fast_routed':sum(c['fast_points']>0 for c in routed),'eligible_routed':sum(c['eligible_power'] for c in routed),'max_gap_km':round(max(known)/1000,1) if known else None,'within_segments':sum(status=='within' for _,_,status in intervals),'near_segments':sum(status=='near' for _,_,status in intervals),'gap_segments':sum(status=='gap' for _,_,status in intervals)})
    # Avoid counting a site twice within one selected direction across sections.
    if len({(c['direction'],c['site_row']) for c in review})!=len(review):raise ValueError('Overlapping sections need explicit site assignment')
    summaries=[]
    for direction in ['north','south']:
        items=[p for p in parts if p['direction']==direction];summary={'direction':direction}
        for k in ['length_km','candidates','routed','fast_routed','eligible_routed']:summary[k]=sum(p[k] for p in items)
        summary['length_km']=round(summary['length_km'],2);summary['max_gap_km']=max((p['max_gap_km'] for p in items if p['max_gap_km'] is not None),default=None);summaries.append(summary)
    metadata={'format':'autobahn-pilot-v1','route':'A1','startup_sites_sha256':sha(sites_path),'site_count':str(sites.num_rows),'source_date':str(sites['source_date'][0].as_py()),'directions':json.dumps(summaries),'sections':json.dumps(parts),'access_network':'true','access_network_sha256':cache['network_sha256'],'access_links_sha256':sha(cache_path),'assessment':'exploratory-not-legal-compliance','access_source':json.dumps(cache['source'])}
    schema=pa.schema([('kind',pa.string()),('direction',pa.string()),('section',pa.string()),('site_row',pa.uint32()),('geometry_json',pa.string()),('chain_m',pa.float64()),('end_m',pa.float64()),('gap_km',pa.float64()),('status',pa.string()),('power_kw',pa.float64()),('fast_points',pa.uint32()),('eligible_power',pa.bool_()),('access_m',pa.float64()),('return_m',pa.float64()),('snap_m',pa.float64())],metadata={k.encode():v.encode() for k,v in metadata.items()})
    table=pa.Table.from_pylist(rows,schema=schema);out=data/'autobahn_a1_zstd10.parquet';pq.write_table(table,out,compression='zstd',compression_level=10)
    if not pq.read_table(out).equals(table):raise ValueError('Parquet round-trip mismatch')
    report={**metadata,'directions':summaries,'sections':parts,'selection':selection,'bytes':out.stat().st_size}
    (source/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    details=pq.read_table(data/'charging_site_details_zstd10.parquet').to_pylist()
    with (source/'site-review.csv').open('w',encoding='utf-8-sig',newline='') as f:
        fields=['section','direction','site_row','address','status','chain_km','power_kw','fast_points','access_m','return_m','snap_m'];writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for c in review:
            d=details[c['site_row']];writer.writerow({k:c.get(k) for k in fields if k not in ['address','chain_km']}|{'address':' '.join(str(d.get(k) or '') for k in ['city','street','house_number','postal_code']),'chain_km':round(c['chain_m']/1000,3)})
    print(json.dumps({'summary':summaries,'sections':parts,'bytes':out.stat().st_size},ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--network',type=Path);args=parser.parse_args();prepare(args.network)

# All browser exports must use the shared pilot policy.
if __name__ == '__main__':
    from prepare_motorways import prepare as prepare_shared
    prepare_shared('A1')
