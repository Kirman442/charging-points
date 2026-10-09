"""Step 32: read-only identity and entrance evidence for four A5 sites.
No PBF scan, routing, automatic identity assignment, or interval recalculation.
"""
import argparse
import csv
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import time
import unicodedata
import zipfile

FOCUS = {29399, 29402, 34033, 34036}
ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def normal(value):
    # No brand aliases or company suffix removal: different operators stay different.
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(value or '')).lower()).strip()


def comparison(left, right):
    if not normal(left) or not normal(right):
        return 'missing_data'
    return 'same_text' if normal(left) == normal(right) else 'different_text_review_required'


def identity(registry, tags):
    pairs = [('operator', 'operator'), ('street', 'addr:street'),
             ('house_number', 'addr:housenumber'), ('postal_code', 'addr:postcode'), ('city', 'addr:city')]
    return {field: {'registry': registry.get(field), 'osm': tags.get(osm),
                    'comparison': comparison(registry.get(field), tags.get(osm))}
            for field, osm in pairs}


def metric_geometry(geometry, project):
    import numpy as np
    from shapely import transform
    return transform(geometry, lambda coords: np.column_stack(project(coords[:, 0], coords[:, 1])))


def on_traversed_path(node_id, nodes_on_ways, geometry, node, project):
    from shapely.geometry import Point
    if node_id not in nodes_on_ways:
        return False
    # A used way may continue beyond a partial final edge. Check actual geometry too.
    distance = metric_geometry(geometry, project).distance(metric_geometry(Point(node['lon'], node['lat']), project))
    return distance <= 0.75


def filtered_features(path):
    return [f for f in read_json(path)['features'] if int(f['properties']['site_row']) in FOCUS]


def run(project_root, previous, network_path, output):
    import pyarrow.parquet as pq
    from pyproj import Transformer
    from shapely.geometry import shape, Point
    start = time.monotonic()
    output = output.resolve()
    if output == previous.resolve() or output.is_relative_to(previous.resolve()):
        raise ValueError('Output must be outside the step 31 input directory.')
    if output == project_root.resolve() or output.is_relative_to((project_root / 'public').resolve()):
        raise ValueError('Output must not replace project data.')
    data = project_root / 'public/data'
    audit = read_json(previous / 'audit.json')
    paths = {name: data / f'charging_{name}_zstd10.parquet' for name in
             ['sites_startup', 'site_details', 'runtime_catalog']}
    print('Checking registry hashes and row binding...', flush=True)
    hashes = {name: fingerprint(path) for name, path in paths.items()}
    startup = pq.read_table(paths['sites_startup'])
    details = pq.read_table(paths['site_details'])
    catalog = pq.read_table(paths['runtime_catalog'])
    meta = catalog.schema.metadata or {}
    dm = details.schema.metadata or {}
    if (hashes['sites_startup'] != audit['startup_sha256'] or
        meta.get(b'startup_sites_sha256', b'').decode() != hashes['sites_startup'] or
        meta.get(b'details_sha256', b'').decode() != hashes['site_details'] or
        dm.get(b'startup_sites_sha256', b'').decode() != hashes['sites_startup'] or
        dm.get(b'source_sites_sha256') != meta.get(b'sites_sha256') or
        (startup.schema.metadata or {}).get(b'source_sites_sha256') != meta.get(b'sites_sha256') or
        startup.num_rows != details.num_rows or max(FOCUS) >= startup.num_rows):
        raise ValueError('Registry files do not match the step 31 audit. Do not join by stale row numbers.')
    registry = {row: {**details.slice(row, 1).to_pylist()[0],
                       **startup.slice(row, 1).to_pylist()[0], 'site_row': row}
                for row in sorted(FOCUS)}
    with (previous / 'site-review.csv').open(encoding='utf-8-sig', newline='') as stream:
        probes = [r for r in csv.DictReader(stream) if int(r['site_row']) in FOCUS]
    if {(int(r['site_row']), r['direction']) for r in probes if r['target_kind'] == 'registry_coordinate'} != {
            (row, direction) for row in FOCUS for direction in ['north', 'south']}:
        raise ValueError('Missing registry probes for the four sites / two directions.')
    for probe in probes:
        site = registry[int(probe['site_row'])]
        if abs(float(probe['longitude']) - site['longitude']) > 1e-7 or abs(float(probe['latitude']) - site['latitude']) > 1e-7:
            raise ValueError('Step 31 coordinates do not match registry row.')
    print('Reading saved local road network (no PBF scan)...', flush=True)
    network = read_json(network_path)
    if (network.get('source', {}).get('sha256') != audit['source']['sha256'] or
        network.get('source', {}).get('route') != 'A5'):
        raise ValueError('Saved A5 network has a different source from step 31.')
    objects = {(e['type'], int(e['id'])): e for e in network['elements']}
    nodes = {key[1]: e for key, e in objects.items() if key[0] == 'node'}
    layers = {name: filtered_features(previous / (name + '.geojson')) for name in
              ['routes', 'sites', 'mapped_chargers', 'entry_candidates', 'osm_areas', 'road_terminals']}
    project = Transformer.from_crs('EPSG:4326', 'EPSG:32632', always_xy=True).transform
    candidates = {}
    # Shared associations are checked across ALL 63 sites, not just the four focus sites.
    for feature in read_json(previous / 'mapped_chargers.geojson')['features']:
        p = feature['properties']
        key = (p['osm_type'], int(p['osm_id']))
        candidates.setdefault(key, set()).add(int(p['site_row']))
    identities = []
    seen = set()
    selected = set()
    for probe in probes:
        if probe['target_kind'] != 'osm_charger_candidate':
            continue
        row = int(probe['site_row'])
        key = (probe['osm_type'], int(probe['osm_id']))
        selected.add(key)
        if key not in objects:
            raise ValueError(f'Mapped charger absent from saved network: {key}')
        if (row, key) in seen:
            continue
        seen.add((row, key))
        obj = objects[key]
        tags = obj.get('tags', {})
        identities.append({'site_row': row, 'site_id': registry[row]['site_id'],
                           'osm_type': key[0], 'osm_id': key[1], 'distance_m': float(probe['association_distance_m']),
                           'shared_with_site_rows': sorted(candidates[key] - {row}),
                           'comparison': identity(registry[row], tags), 'osm_tags': tags,
                           'association_verified': False, 'entrance_verified': False,
                           'power_note': 'Registry totals describe a site/installation; OSM may describe one device or connector. Do not equate these levels.'})
    for feature in layers['osm_areas']:
        p = feature['properties']
        selected.add((p['osm_type'], int(p['osm_id'])))
    for feature in layers['entry_candidates']:
        p = feature['properties']
        if p.get('node_osm_id'):
            selected.add(('node', int(p['node_osm_id'])))
    tagged_nodes = {nid: n for nid, n in nodes.items() if any(k in n.get('tags', {}) for k in ['barrier', 'entrance', 'routing:entrance'])}
    checks = []
    road_features = {}
    print('Checking actual route geometry against tagged entrance / barrier nodes...', flush=True)
    for feature in layers['routes']:
        p = feature['properties']
        leg = p['leg']
        way_ids = [int(w) for w in json.loads(p['arrival_ways_json'] if leg == 'arrival' else p['departure_ways_json'])]
        node_ids = set()
        for wid in way_ids:
            key = ('way', wid)
            if key not in objects:
                raise ValueError(f'Route way missing: {wid}')
            selected.add(key)
            way = objects[key]
            node_ids.update(way['nodes'])
            if any(nid not in nodes for nid in way['nodes']):
                raise ValueError(f'Incomplete route way: {wid}')
            if wid not in road_features:
                road_features[wid] = {'type': 'Feature', 'properties': {'osm_id': wid, 'tags_json': json.dumps(way.get('tags', {}), ensure_ascii=False)},
                                      'geometry': {'type': 'LineString', 'coordinates': [[nodes[n]['lon'], nodes[n]['lat']] for n in way['nodes']]}}
        geometry = shape(feature['geometry'])
        metric = metric_geometry(geometry, project)
        nearby = []
        for nid, node in tagged_nodes.items():
            gap = metric.distance(metric_geometry(Point(node['lon'], node['lat']), project))
            if gap > 30:
                continue
            selected.add(('node', nid))
            nearby.append({'osm_id': nid, 'tags': node.get('tags', {}), 'distance_to_route_m': round(gap, 2),
                           'node_on_used_way': nid in node_ids,
                           'on_traversed_geometry': on_traversed_path(nid, node_ids, geometry, node, project),
                           'entrance_verified': False})
        target_point = geometry.coords[-1] if leg == 'arrival' else geometry.coords[0]
        relevant_areas = [a for a in layers['osm_areas'] if a['properties']['site_row'] == p['site_row'] and a['properties']['direction'] == p['direction']]
        checks.append({'site_row': p['site_row'], 'direction': p['direction'], 'target_kind': p['target_kind'],
                       'osm_type': p.get('osm_type'), 'osm_id': p.get('osm_id'), 'leg': leg,
                       'access_m': p['access_m'], 'return_m': p['return_m'], 'snap_m': p['snap_m'],
                       'way_ids': way_ids, 'road_terminal': list(target_point), 'nearby_tagged_nodes': nearby,
                       'terminal_inside_candidate_area_ids': sorted({a['properties']['osm_id'] for a in relevant_areas if shape(a['geometry']).covers(Point(target_point))}),
                       'entrance_verified': False})
    # Include all tagged restrictions that mention used ways for manual inspection.
    used_way_ids = {ident for kind, ident in selected if kind == 'way'}
    for key, obj in objects.items():
        if key[0] == 'relation' and obj.get('tags', {}).get('type') == 'restriction' and any(
                m['type'] == 'way' and m['ref'] in used_way_ids for m in obj.get('members', [])):
            selected.add(key)
    relevant_objects = [objects[key] for key in sorted(selected) if key in objects]
    result = {'method': 'a5-four-site-identity-and-entry-review-v1', 'site_rows': sorted(FOCUS),
              'source': audit['source'], 'registry_hashes': hashes, 'network_sha256': fingerprint(network_path),
              'previous_audit_sha256': fingerprint(previous / 'audit.json'),
              'confirmed_entrances': 0, 'association_verified': False, 'intervals_recalculated': False,
              'routing_performed': False, 'pbf_scanned': False, 'elapsed_seconds': round(time.monotonic() - start, 1),
              'limits': 'Read-only evidence review. Tagged nodes on route geometry are not verified entrances. No missing entrance connection is invented.'}
    output.mkdir(parents=True, exist_ok=True)
    files = []
    def emit(name, value):
        path = output / name
        save_json(path, value)
        files.append(path)
    emit('audit.json', result)
    emit('registry-details.json', list(registry.values()))
    emit('identity-review.json', identities)
    emit('path-checks.json', checks)
    emit('osm-object-details.json', {'source': network['source'], 'elements': relevant_objects})
    for name, features in layers.items():
        emit(name + '.geojson', {'type': 'FeatureCollection', 'features': features})
    emit('focus-roads.geojson', {'type': 'FeatureCollection', 'features': list(road_features.values())})
    csvpath = output / 'identity-review.csv'
    fields = ['site_row', 'site_id', 'registry_operator', 'registry_address', 'osm_type', 'osm_id', 'osm_operator',
              'osm_name', 'distance_m', 'operator_comparison', 'shared_with_site_rows', 'association_verified', 'entrance_verified']
    with csvpath.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for item in identities:
            reg = registry[item['site_row']]
            writer.writerow({'site_row': item['site_row'], 'site_id': reg['site_id'], 'registry_operator': reg['operator'],
                             'registry_address': ', '.join(str(reg.get(k) or '') for k in ['postal_code', 'city', 'street', 'house_number']),
                             'osm_type': item['osm_type'], 'osm_id': item['osm_id'], 'osm_operator': item['osm_tags'].get('operator', ''),
                             'osm_name': item['osm_tags'].get('name', ''), 'distance_m': item['distance_m'],
                             'operator_comparison': item['comparison']['operator']['comparison'],
                             'shared_with_site_rows': json.dumps(item['shared_with_site_rows']),
                             'association_verified': False, 'entrance_verified': False})
    files.append(csvpath)
    body = ['<!doctype html><html lang="ru"><meta charset="utf-8"><title>A5 — проверка четырёх площадок</title>',
            '<style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:0 20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left}pre{white-space:pre-wrap}details{margin:12px 0}</style>',
            '<h1>A5 — сопоставление площадок и проверка путей</h1><p>Въезды и соответствие объектов пока не подтверждены. Интервалы не пересчитывались. different_text_review_required означает различие названий, которое требует разбора; это не доказательство разных операторов.</p>']
    for row, reg in registry.items():
        body.append(f'<h2>Площадка {row} — {html.escape(str(reg["operator"]))}</h2><p>' + html.escape(', '.join(str(reg.get(k) or '') for k in ['postal_code', 'city', 'street', 'house_number'])) + '</p>')
        body.append(f'<p>Мощность установок: {reg["installed_power_kw"]} кВт. Мощности точек: {html.escape(str(reg["available_power_kw"]))}. Сравнивать суммарную мощность площадки с одной зарядкой OSM напрямую нельзя.</p>')
        for item in [i for i in identities if i['site_row'] == row]:
            url = f'https://www.openstreetmap.org/{item["osm_type"]}/{item["osm_id"]}'
            body.append(f'<p><a href="{url}">OSM {item["osm_type"]} {item["osm_id"]}</a> · {item["distance_m"]} м. Другие площадки с этим кандидатом: {html.escape(str(item["shared_with_site_rows"]))}</p><details><summary>Оператор, адрес и теги</summary><pre>' + html.escape(json.dumps(item, ensure_ascii=False, indent=2)) + '</pre></details>')
        body.append('<details><summary>Подъезд, возврат, въезды и шлагбаумы на пути</summary><pre>' + html.escape(json.dumps([c for c in checks if c['site_row'] == row], ensure_ascii=False, indent=2)) + '</pre></details>')
    body.append('<p>on_traversed_geometry: узел относится к использованной дороге и лежит на реально пройденной части геометрии (допуск 0,75 м). Это геометрическая проверка, не подтверждение въезда. Остальные близкие узлы могут принадлежать соседним дорогам.</p></html>')
    report = output / 'review.html'
    report.write_text('\n'.join(body), encoding='utf-8')
    files.append(report)
    archive = output / '32-a5-identity-review-results.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as zipped:
        for path in files:
            zipped.write(path, path.name)
    print(f'Done in {time.monotonic() - start:.1f}s. Results: {archive}', flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=ROOT)
    parser.add_argument('--previous', type=Path, required=True)
    parser.add_argument('--network', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    network = args.network or args.previous / 'network/a5/access-network.json'
    try:
        run(args.project, args.previous, network, args.output)
    except (OSError, ValueError, KeyError, ImportError) as error:
        print(f'Review failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
