"""Shared pilot policy: 3 km outbound/return, road mileage between pools.

Reuses audited road links; A1/A9 require fresh road extracts for a new route search.
Rejected cached links remain candidates, never legal non-compliance claims.
"""
import argparse, json, csv
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq
from shapely.geometry import LineString
from shapely.ops import substring
from prepare_a9 import read_objects, relation_ways, assemble_routes, sha, UNPROJECT, PROJECT
from a1_topology import build

ROOT = Path(__file__).resolve().parents[1]
POLICY = 'pilot-3km-out-3km-back-v1'

def reason_label(flag):
    return {'access_exceeds_3km':'Подъезд превышает 3 км',
            'return_exceeds_model_10km':'Возврат превышает предел пилота',
            'snap_exceeds_model_60m':'До ближайшей дороги больше 60 м',
            'strict_route_found_opposite_direction':'Связь найдена с другим направлением',
            'route_only_when_access_barrier_or_turn_checks_removed':'Требуется проверка доступа, барьеров или поворотов',
            'no_route_even_in_relaxed_model':'Причина не установлена: проверить топологию и координаты',
            'no_driving_road_within_200m_coordinate_or_mapping_review':'Дорога не найдена в пределах 200 м: проверить координаты и OSM'}.get(flag,flag)

def intervals(length, sites):
    groups = {}
    for site in sites:
        if site['status'] == 'road_route_found_entrance_unverified' and site['eligible_power']:
            groups.setdefault(site['chain_m'], []).append(site)
    anchors = sorted(groups)
    if not anchors:
        return [(0., length, 'unknown', length / 1000)]
    result = []
    bounds = sorted(set([0., *anchors, length]))
    for a, b in zip(bounds, bounds[1:]):
        distances = [x['return_m'] + b - x['entry_chain_m'] + y['access_m']
                     for x in groups.get(a, []) for y in groups.get(b, [])
                     if x['entry_chain_m'] <= b]
        gap = min(distances) / 1000 if distances else (b-a)/1000
        status = 'unknown' if not distances else 'gap' if gap > 60 else 'near' if gap > 50 else 'within'
        result.append((a,b,status,gap))
    return result

def routes_for(route):
    source = ROOT / 'data_sources' / route.lower()
    if route == 'A1':
        return build()[0]
    if route == 'A5':
        return json.loads((source/'routes.json').read_text())['routes']
    objects = read_objects(source)
    return assemble_routes(objects, [*relation_ways(objects,20738),725303216,725303217])

def prepare(route):
    data = ROOT/'public/data'; source = ROOT/'data_sources'/route.lower()
    output = data/f'autobahn_{route.lower()}_zstd10.parquet'
    startup = data/'charging_sites_startup_zstd10.parquet'
    if route == 'A5':
        audit = json.loads((source/'audit.json').read_text())
        if sha(startup) != audit['startup_sites_sha256']:
            raise ValueError('A5 startup mismatch')
        original = json.loads((source/'diagnostics.json').read_text())
        sites = [dict(kind='site',direction=r['direction'],section=None,site_row=r['site_row'],
                      geometry_json=json.dumps([r['longitude'],r['latitude']]),chain_m=r['chain_m'],
                      power_kw=r['power_kw'],fast_points=r['fast_points'],eligible_power=r['eligible_power'],review_detail='; '.join(reason_label(f) for f in r['diagnostic_flags'] if not f.startswith('strict_route_found_entrance') and not f.startswith('strict_route_found_after'))) for r in original]
        metadata = {'route':'A5','source_date':'2026-09-01','startup_sites_sha256':sha(startup),
                    'site_count':str(pq.read_metadata(startup).num_rows),'access_network':'true',
                    'access_network_sha256':audit['network_sha256']}
    else:
        old = pq.read_table(output)
        metadata = {k.decode():v.decode() for k,v in old.schema.metadata.items()}
        if metadata['startup_sites_sha256'] != sha(startup):
            raise ValueError('Startup mismatch')
        sites = [r for r in old.to_pylist() if r['kind']=='site']
    cache = json.loads((source/'access-links.json').read_text())
    links = {(m.get('section'),m['direction'],m['site_row']):m for m in cache['matches']}
    refresh=source/'pilot-access-links.json'
    if refresh.exists():
        new=json.loads(refresh.read_text())
        if new['routing_policy'] != POLICY or new['network_sha256'] != metadata.get('access_network_sha256'):
            raise ValueError('Stale pilot links')
        links.update({(m.get('section'),m['direction'],m['site_row']):m for m in new['matches']})
    rows=[]; parts=[]
    for r in routes_for(route):
        direction=r['direction']; section=r.get('section')
        line=r.get('line') or LineString([PROJECT.transform(*p) for p in r['coordinates']])
        chain=dict(zip(r['nodes'],r['chain']))
        candidates=[s for s in sites if s['direction']==direction and s.get('section')==section]
        for s in candidates:
            s.setdefault('review_detail',None)
            m=links.get((section,direction,s['site_row']))
            good=bool(m and m['access_m']<=3000 and m['return_m']<=3000 and m['snap_m']<=60)
            s.update(status='road_route_found_entrance_unverified' if good else 'unconfirmed',
                     review_reason='return_exceeds_pilot_3km' if m and m['return_m']>3000 else '' if good else 'route_unconfirmed',
                     end_m=None,gap_km=None,entry_chain_m=None,road_gap_km=None)
            for k in ['access_m','return_m','snap_m']:
                s[k]=m[k] if m else None
            if m:
                s['chain_m']=m['chain_m']
                s['entry_chain_m']=chain[m['entry_node']]
            if good:
                assert chain[m['exit_node']]==m['chain_m']
        gaps=intervals(line.length,candidates)
        for a,b,status,gap in gaps:
            rows.append(dict(kind='segment',direction=direction,section=section,site_row=None,
                             geometry_json=json.dumps([UNPROJECT.transform(*p) for p in substring(line,a,b).coords]),
                             chain_m=a,end_m=b,status=status,gap_km=gap,road_gap_km=(b-a)/1000,
                             power_kw=None,fast_points=None,eligible_power=None,access_m=None,return_m=None,
                             snap_m=None,entry_chain_m=None,review_reason=None,review_detail=None))
        rows.extend(candidates)
        routed=[s for s in candidates if s['status']=='road_route_found_entrance_unverified']
        known=[gap for _,_,status,gap in gaps if status!='unknown']
        parts.append(dict(direction=direction,section=section,length_km=round(line.length/1000,3),
                          candidates=len(candidates),routed=len(routed),fast_routed=sum(s['fast_points']>0 for s in routed),
                          eligible_routed=sum(s['eligible_power'] for s in routed),max_gap_km=round(max(known),1) if known else None,
                          unknown_segments=sum(status=='unknown' for _,_,status,_ in gaps),verified_entrances=0))
    summaries=[]
    for direction in ['north','south']:
        pp=[p for p in parts if p['direction']==direction]
        summary={'direction':direction}
        for k in ['length_km','candidates','routed','fast_routed','eligible_routed','unknown_segments','verified_entrances']:
            summary[k]=sum(p[k] for p in pp)
        summary['length_km']=round(summary['length_km'],2)
        summary['max_gap_km']=max((p['max_gap_km'] for p in pp if p['max_gap_km'] is not None),default=None)
        summaries.append(summary)
    metadata.update(format='autobahn-pilot-v2',route=route,routing_policy=POLICY,
                    interval_method='return-road-approach-v1',directions=json.dumps(summaries),
                    sections=json.dumps(parts) if route=='A1' else 'null',assessment='exploratory-not-legal-compliance',
                    access_links_sha256=sha(source/'access-links.json'))
    table=pa.Table.from_pylist(rows)
    types={'site_row':pa.uint32(),'fast_points':pa.uint32()}
    table=table.cast(pa.schema([(field.name,types.get(field.name,field.type)) for field in table.schema]))
    table=table.replace_schema_metadata({k.encode():v.encode() for k,v in metadata.items()})
    pq.write_table(table,output,compression='zstd',compression_level=10)
    assert pq.read_table(output).equals(table)
    report={'route':route,'routing_policy':POLICY,'interval_method':metadata['interval_method'],
            'directions':summaries,'sections':parts,'cached_link_revalidation':not refresh.exists(), 'fresh_network_search':refresh.exists()}
    (source/'pilot-3km-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    with (source/'pilot-3km-site-review.csv').open('w',newline='',encoding='utf-8-sig') as f:
        fields=['direction','section','site_row','status','review_reason','access_m','return_m','snap_m','power_kw','fast_points','review_detail']
        writer=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(sites)
    print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--route',choices=['A1','A5','A9']);args=parser.parse_args()
    for route in [args.route] if args.route else ['A1','A5','A9']:
        prepare(route)
