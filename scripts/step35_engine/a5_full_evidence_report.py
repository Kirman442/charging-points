"""Join A5 registry / OSM evidence without confirming identities or entrances."""
import csv
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path


def normalized(value):
    return ' '.join(unicodedata.normalize('NFC', str(value or '')).lower().split())


def operator_status(registry, osm):
    if not normalized(registry) or not normalized(osm):
        return 'missing_data'
    return 'same_text' if normalized(registry) == normalized(osm) else 'different_text_review_required'


def output_powers(tags):
    powers = set()
    for key, value in tags.items():
        if not key.startswith('socket:') or not key.endswith(':output'):
            continue
        match = re.fullmatch(r'\s*(\d+(?:[.,]\d+)?)\s*(kW|W)\s*', value, flags=re.I)
        if match:
            powers.add(float(match[1].replace(',', '.')) / (1000 if match[2].lower() == 'w' else 1))
    return sorted(powers)


def report(project, output, network_path):
    import pyarrow.parquet as pq
    from pyproj import Transformer
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree
    from extract_a5_full_network import transform
    read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
    details = pq.read_table(project / 'public/data/charging_site_details_zstd10.parquet').to_pylist()
    payload = read(network_path)
    objects = {(o['type'], o['id']): o for o in payload['elements']}
    del payload
    site_features = read(output / 'sites.geojson')['features']
    charger_features = read(output / 'mapped_chargers.geojson')['features']
    area_features = read(output / 'osm_areas.geojson')['features']
    route_features = read(output / 'routes.geojson')['features']
    areas = defaultdict(dict)
    for f in area_features:
        p = f['properties']
        areas[p['site_row'], p['direction']][p['osm_id']] = shape(f['geometry'])
    associations = defaultdict(set)
    by_site = defaultdict(dict)
    for f in charger_features:
        p = f['properties']; key = (p['osm_type'], p['osm_id'])
        associations[key].add(p['site_row'])
        by_site[p['site_row'], p['direction']][key] = f
    with (output / 'site-review.csv').open(encoding='utf-8-sig', newline='') as stream:
        probes = list(csv.DictReader(stream))
    probe_index = {(int(r['site_row']), r['direction'], r['target_kind'], r['osm_type'], int(r['osm_id']) if r['osm_id'] else None): r for r in probes}
    identity_rows = []
    identity_details = []
    for f in charger_features:
        p = f['properties']; row = p['site_row']; reg = details[row]
        key = (p['osm_type'], p['osm_id']); obj = objects[key]; tags = obj.get('tags', {})
        kind = operator_status(reg['operator'], tags.get('operator'))
        charger = shape(f['geometry']); registry = Point(p['longitude'], p['latitude'])
        containing = [ident for ident, polygon in areas[row, p['direction']].items() if polygon.covers(charger)]
        common = [ident for ident in containing if areas[row, p['direction']][ident].covers(registry)]
        laybys = [ident for ident in common if objects['way', ident].get('tags', {}).get('parking') == 'layby']
        comparison = {name: {'registry': reg.get(name), 'osm': tags.get(osm), 'comparison': operator_status(reg.get(name), tags.get(osm))} for name, osm in
                      [('street', 'addr:street'), ('house_number', 'addr:housenumber'), ('postal_code', 'addr:postcode'), ('city', 'addr:city')]}
        mapped_powers = output_powers(tags)
        evidence = {'site_row': row, 'site_id': reg['site_id'], 'direction': p['direction'],
                    'registry_operator': reg['operator'], 'registry_address': ', '.join(str(reg.get(k) or '') for k in ['postal_code','city','street','house_number']),
                    'osm_type': key[0], 'osm_id': key[1], 'osm_operator': tags.get('operator',''),
                    'operator_comparison': kind, 'distance_m': p['registry_distance_m'],
                    'shared_with_site_rows': sorted(associations[key] - {row}),
                    'registry_point_powers_kw': reg['available_power_kw'], 'osm_connector_powers_kw': mapped_powers,
                    'common_reported_power_kw': sorted(set(reg['available_power_kw']) & set(mapped_powers)),
                    'same_area_ids': common, 'same_layby_ids': laybys,
                    'mapped_target_route_found': probe_index[row,p['direction'],'osm_charger_candidate',key[0],key[1]]['status']=='road_route_found',
                    'association_verified': False, 'entrance_verified': False}
        identity_rows.append(evidence)
        identity_details.append({**evidence, 'address_comparison': comparison, 'osm_tags': tags})
    project_metric = Transformer.from_crs(4326,32632,always_xy=True).transform
    tagged = [o for key,o in objects.items() if key[0]=='node' and any(k in o.get('tags',{}) for k in ['entrance','routing:entrance','barrier'])]
    tagged_points = [Point(project_metric(o['lon'],o['lat'])) for o in tagged]
    tagged_tree = STRtree(tagged_points)
    pathchecks = []
    per_site_checks = defaultdict(list)
    for f in route_features:
        p = f['properties']; geometry = transform(project_metric,shape(f['geometry']))
        wid = json.loads(p['arrival_ways_json'] if p['leg']=='arrival' else p['departure_ways_json'])
        actual_nodes = {n for w in wid for n in objects['way',w]['nodes']}
        nearby = []
        for index in tagged_tree.query(geometry.buffer(30)):
            index = int(index); obj = tagged[index]; gap = geometry.distance(tagged_points[index])
            if gap <= 30:
                nearby.append({'osm_id':obj['id'],'tags':obj.get('tags',{}),'distance_to_route_m':round(gap,2),
                               'on_traversed_geometry': obj['id'] in actual_nodes and gap <= 0.75})
        terminal = shape(f['geometry']).coords[-1 if p['leg']=='arrival' else 0]
        terminal_tags = objects['way',wid[-1 if p['leg']=='arrival' else 0]].get('tags',{}) if wid else {}
        check = {k:p.get(k) for k in ['site_row','direction','target_kind','osm_type','osm_id','leg','access_m','return_m','snap_m']}
        check.update({'nearby_tagged_nodes':nearby,'road_terminal':list(terminal),'terminal_way_tags':terminal_tags,'entrance_verified':False})
        pathchecks.append(check); per_site_checks[p['site_row'],p['direction']].append(check)
    identities_by_site = defaultdict(list)
    for r in identity_rows:identities_by_site[r['site_row'],r['direction']].append(r)
    summaries = []
    for f in site_features:
        p=f['properties']; reg=details[p['site_row']]; evidence=identities_by_site[p['site_row'],p['direction']]
        eligible=p['power_kw']>=400 and p['fast_points']>0
        priority=1 if eligible and not p['road_route_found'] else 2 if eligible else 3 if p['fast_points'] else 4
        summary={**p,'site_id':reg['site_id'],'operator':reg['operator'],
                 'address':', '.join(str(reg.get(k) or '') for k in ['postal_code','city','street','house_number']),
                 'eligible_power':eligible,'review_priority':priority,
                 'same_operator_candidates':sum(r['operator_comparison']=='same_text' for r in evidence),
                 'different_operator_text_candidates':sum(r['operator_comparison']=='different_text_review_required' for r in evidence),
                 'shared_osm_candidates':sum(bool(r['shared_with_site_rows']) for r in evidence),
                 'same_area_candidates':sum(bool(r['same_area_ids']) for r in evidence),
                 'same_layby_candidates':sum(bool(r['same_layby_ids']) for r in evidence),
                 'tagged_nodes_on_routes':len({n['osm_id'] for c in per_site_checks[p['site_row'],p['direction']] for n in c['nearby_tagged_nodes'] if n['on_traversed_geometry']}),
                 'entrance_verified':False,'association_verified':False}
        summaries.append(summary)
    summaries.sort(key=lambda r:(r['review_priority'],r['direction'],r['site_row']))
    def save(name,data):
        (output/name).write_text(json.dumps(data,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    def csvfile(name,rows):
        fields=list(dict.fromkeys(k for r in rows for k in r)) or ['site_row','direction']
        with (output/name).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
            for r in rows:writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()})
    save('identity-details.json',identity_details);save('path-checks.json',pathchecks)
    csvfile('identity-review.csv',identity_rows);csvfile('site-summary.csv',summaries)
    csvfile('priority-review.csv',[r for r in summaries if r['review_priority']<=2])
    return {'unique_sites':len({p['site_row'] for p in summaries}),'directional_cases':len(summaries),
            'priority_cases':sum(r['review_priority']<=2 for r in summaries),'identity_candidates':len(identity_rows),
            'confirmed_entrances':0,'intervals_recalculated':False}
