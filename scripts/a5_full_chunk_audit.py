"""Audit a small A5 section without changing browser datasets or interval claims."""
import argparse
import csv
import gc
import hashlib
import json
import os
import shutil
import time
from pathlib import Path

import pyarrow.parquet as pq
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, Polygon, mapping
from shapely.ops import substring

from a5_full_road_access import Network, PROJECT

ROOT = Path(__file__).resolve().parents[1]
UNPROJECT = Transformer.from_crs(32632, 4326, always_xy=True)
METHOD = 'a5-entry-evidence-audit-v1'
ACCESS = RETURN = 3000
SNAP = 60
POI_RADIUS = 150


def log(message):
    print(time.strftime('%H:%M:%S'), message, flush=True)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def write_json(path, data):
    temporary = path.with_suffix(path.suffix + '.part')
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    temporary.replace(path)


def feature(geometry, properties):
    return {'type': 'Feature', 'geometry': mapping(geometry), 'properties': properties}


def geographic(geometry):
    from extract_a5_full_network import transform
    return transform(UNPROJECT.transform, geometry)


def directed_elements(elements, route):
    selected = set(route['way_ids'])
    result = []
    for obj in elements:
        if obj['type'] == 'way':
            tags = obj.get('tags', {})
            if tags.get('area') == 'yes':
                obj = {**obj, 'tags': {**tags, 'highway': ''}}
            elif obj['id'] in selected:
                obj = {**obj, 'tags': {**tags, 'highway': 'motorway'}}
            elif tags.get('highway') == 'motorway':
                obj = {**obj, 'tags': {**tags, 'highway': 'trunk', 'oneway': tags.get('oneway', 'yes')}}
        result.append(obj)
    return result


def trace_match(network, point, context):
    """Return actual directed road geometry, stopping at the road projection."""
    if not len(network.projection_tree.geometries):
        return None
    match = network.match(point, context, max_access=ACCESS, max_return=RETURN, max_snap=SNAP)
    if match is None:
        return None
    closest = network.projection_tree.geometries[int(network.projection_tree.nearest(point))].distance(point)
    choices = []
    for index in network.tree.query(point.buffer(SNAP)):
        index = int(index)
        edge = network.edges[index]
        snap = edge['line'].distance(point)
        if snap > SNAP or snap > closest + 0.5 or index not in context['distances'] or index not in context['returns']:
            continue
        along = edge['line'].project(point)
        access = context['distances'][index] + along
        back = context['returns'][index] + edge['length'] - along
        if access <= ACCESS and back <= RETURN:
            choices.append((snap, access, back, index))
    _, access, back, index = min(choices)
    edge = network.edges[index]
    along = edge['line'].project(point)
    terminal = edge['line'].interpolate(along)
    arrival = []
    current = context['parents'][index]
    while current is not None:
        arrival.append(current)
        current = context['parents'][current]
    arrival.reverse()
    departure = []
    current = context['return_children'][index]
    while current is not None:
        departure.append(current)
        current = context['return_children'][current]

    def combine(parts, endpoint):
        coordinates = []
        for part in parts:
            points = list(part.coords)
            if coordinates and coordinates[-1] != points[0]:
                raise ValueError('Disconnected route geometry; no artificial joining allowed')
            coordinates.extend(points if not coordinates else points[1:])
        return LineString(coordinates) if len(coordinates) > 1 else endpoint

    access_parts = [network.edges[i]['line'] for i in arrival]
    if along > 1e-8:
        access_parts.append(substring(edge['line'], 0, along))
    return_parts = []
    if edge['length'] - along > 1e-8:
        return_parts.append(substring(edge['line'], along, edge['length']))
    return_parts.extend(network.edges[i]['line'] for i in departure)
    arrival_geometry = combine(access_parts, terminal)
    return_geometry = combine(return_parts, terminal)
    if abs(arrival_geometry.length - access) > 1e-6 or abs(return_geometry.length - back) > 1e-6:
        raise ValueError('Route distance/geometry mismatch')
    used = [*arrival, index, *departure]
    return {'match': match, 'arrival': arrival_geometry, 'return': return_geometry,
            'terminal': terminal, 'node_ids': {n for i in used for n in (network.edges[i]['u'], network.edges[i]['v'])}}


def pois(elements, coordinates):
    chargers, areas, entrances = [], [], []
    for obj in elements:
        tags = obj.get('tags', {})
        if obj['type'] == 'node':
            geometry = Point(coordinates[obj['id']])
            if tags.get('amenity') == 'charging_station':
                chargers.append({'osm_type': 'node', 'osm_id': obj['id'], 'geometry': geometry, 'tags': tags})
            if 'entrance' in tags or 'routing:entrance' in tags or 'barrier' in tags:
                entrances.append({'osm_type': 'node', 'osm_id': obj['id'], 'geometry': geometry, 'tags': tags})
        elif obj['type'] == 'way' and tags.get('amenity') in ('parking', 'charging_station'):
            nodes = obj['nodes']
            if len(nodes) >= 4 and nodes[0] == nodes[-1]:
                polygon = Polygon([coordinates[n] for n in nodes])
                if polygon.is_valid and polygon.area > 0:
                    area = {'osm_type': 'way', 'osm_id': obj['id'], 'geometry': polygon, 'tags': tags}
                    areas.append(area)
                    if tags['amenity'] == 'charging_station':
                        chargers.append({**area, 'geometry': polygon.representative_point(), 'area_geometry': polygon})
    return chargers, areas, entrances


def entry_evidence(point, targets, areas, entrances, network, raw_ways):
    """Find candidates only: neither an entrance tag nor a crossing is proof."""
    references = [point, *[t['geometry'] for t in targets]]
    associated = [a for a in areas if any(a['geometry'].covers(p) for p in references)]
    entries = []
    seen = set()
    for area in associated:
        for i in network.tree.query(area['geometry']):
            edge = network.edges[int(i)]
            tags = raw_ways[edge['way']].get('tags', {})
            if tags.get('highway') != 'service' or not edge['line'].crosses(area['geometry']):
                continue
            crossing = edge['line'].intersection(area['geometry'].boundary)
            points = [crossing] if crossing.geom_type == 'Point' else list(crossing.geoms) if crossing.geom_type == 'MultiPoint' else []
            for p in points:
                key = (area['osm_id'], edge['way'], round(p.x, 2), round(p.y, 2))
                if key in seen:
                    continue
                seen.add(key)
                entries.append((p, {'evidence': 'permitted_service_road_crosses_associated_area',
                                    'area_osm_id': area['osm_id'], 'way_osm_id': edge['way'],
                                    'service': tags.get('service', ''), 'association_verified': False}))
    for entrance in entrances:
        node = entrance['osm_id']
        if not network.outgoing.get(node) and not network.incoming.get(node):
            continue  # A building/foot entrance alone is not vehicle access.
        if min(entrance['geometry'].distance(p) for p in references) <= 200:
            entries.append((entrance['geometry'], {'evidence': 'tagged_node_on_permitted_driving_graph',
                                                   'node_osm_id': node, 'tags_json': json.dumps(entrance['tags']),
                                                   'association_verified': False}))
    return entries, associated


def section_inputs(project, direction, chain_start, chain_end):
    routes = json.loads((project / 'data_sources/a5/routes.json').read_text(encoding='utf-8'))['routes']
    core = json.loads((project / 'data_sources/a5/core.json').read_text(encoding='utf-8'))['elements']
    objects = {(o['type'], o['id']): o for o in core}
    table = pq.read_table(project / 'public/data/autobahn_a5_zstd10.parquet')
    if table.schema.metadata[b'startup_sites_sha256'].decode() != digest(project / 'public/data/charging_sites_startup_zstd10.parquet'):
        raise ValueError('A5 pilot belongs to a different registry snapshot')
    route = next(r for r in routes if r['direction'] == direction)
    route['line'] = LineString([PROJECT.transform(*p) for p in route['coordinates']])
    chain = route['chain']
    # Retain enclosing vertices; the 8 km network buffer protects chunk boundaries.
    first = max(0, next((i for i, x in enumerate(chain) if x >= chain_start), len(chain)-1)-1)
    last = next((i for i, x in enumerate(chain) if x >= chain_end), len(chain)-1)
    seed = MultiLineString([route['coordinates'][first:last+1]])
    candidates = []
    for row in table.to_pylist():
        if row['kind'] != 'site' or row['direction'] != direction:
            continue
        lon, lat = json.loads(row['geometry_json'])
        point = Point(PROJECT.transform(lon, lat))
        projection = route['line'].project(point)
        if in_chunk(projection, chain_start, chain_end, route['length_m']) and route['line'].distance(point) <= 3500:
            candidates.append({'site_row': row['site_row'], 'direction': direction,
                               'longitude': lon, 'latitude': lat, 'power_kw': row['power_kw'],
                               'fast_points': row['fast_points'], 'previous_status': row['status']})
    return [route], objects, candidates, seed


def in_chunk(chain, lower, upper, length):
    return lower <= chain and (chain < upper or upper >= length and chain <= length)


def audit(project, pbf, output, direction, chain_start, chain_end, network_path):
    output.mkdir(parents=True, exist_ok=True)
    work = output / 'work'
    work.mkdir(exist_ok=True)
    os.environ['TMP'] = os.environ['TEMP'] = str(work.resolve())
    started = time.monotonic()
    routes, core, candidates, seed = section_inputs(project, direction, chain_start, chain_end)
    log(f'A5 {direction} {chain_start/1000:.1f}–{chain_end/1000:.1f} km: {len(candidates)} candidates')
    log('Loading extracted roads and mapped charger/parking/entrance features')
    payload = json.loads(network_path.read_text(encoding='utf-8'))
    source = payload['source']
    elements = payload['elements']
    # Limit a supplied larger extract too. Include complete intersecting ways
    # and all their nodes; restrictions touching these ways are retained.
    from extract_a5_full_network import transform
    corridor = transform(PROJECT.transform, seed).buffer(8000)
    coordinates = {o['id']: PROJECT.transform(o['lon'], o['lat']) for o in elements if o['type'] == 'node'}
    raw_ways = {}
    for obj in elements:
        if obj['type'] == 'way':
            xy = [coordinates[n] for n in obj['nodes']]
            if LineString(xy).intersects(corridor):
                raw_ways[obj['id']] = obj
    needed = {n for w in raw_ways.values() for n in w['nodes']}
    filtered = []
    for obj in elements:
        if obj['type'] == 'way' and obj['id'] in raw_ways:
            filtered.append(obj)
        elif obj['type'] == 'node' and (obj['id'] in needed or corridor.covers(Point(coordinates[obj['id']]))):
            filtered.append(obj)
        elif obj['type'] == 'relation' and any(m['type'] == 'way' and m['ref'] in raw_ways for m in obj.get('members', [])):
            filtered.append(obj)
    del payload, elements
    gc.collect()
    chargers, areas, entrances = pois(filtered, coordinates)
    log(f'{len(raw_ways)} local ways; {len(chargers)} mapped charger objects; {len(areas)} areas')
    selected = {('way', wid): raw_ways.get(wid, core.get(('way', wid))) for r in routes for wid in r['way_ids']}
    if any(v is None for v in selected.values()):
        raise ValueError('Audited main-way source is incomplete')
    for route in routes:
        actual = {}
        for wid in route['way_ids']:
            way = selected['way', wid]
            ns = way['nodes'][::-1] if way.get('tags', {}).get('oneway') == '-1' else way['nodes']
            actual.update({(a, b): wid for a, b in zip(ns, ns[1:])})
        for (a, b), coordinate in zip(zip(route['nodes'], route['nodes'][1:]), route['coordinates']):
            if corridor.covers(Point(PROJECT.transform(*coordinate))):
                if (a, b) not in actual or actual[a, b] not in raw_ways:
                    raise ValueError('Current PBF main-route topology differs from audited A5 path')
                if Point(coordinates[a]).distance(Point(PROJECT.transform(*coordinate))) > 0.5:
                    raise ValueError('Current PBF main-route coordinates changed; refresh audited A5 geometry')
    route_features, site_features, entry_features, area_features, charger_features, terminal_features, review = [], [], [], [], [], [], []
    for route in routes:
        direction = route['direction']
        log(f'Searching {direction}: approach/return <=3 km, snap <=60 m')
        network = Network(directed_elements(filtered, route))
        context = network.search(route, selected, route['way_ids'], max_access=ACCESS, max_return=RETURN)
        for site_index, site in enumerate([s for s in candidates if s['direction'] == direction]):
            if site_index % 25 == 0:
                log(f'{direction}: checking site {site_index + 1}')
            point = Point(PROJECT.transform(site['longitude'], site['latitude']))
            targets = sorted([c for c in chargers if c['geometry'].distance(point) <= POI_RADIUS],
                             key=lambda c: (c['geometry'].distance(point), c['osm_type'], c['osm_id']))
            for charger in targets:
                charger_features.append(feature(geographic(charger['geometry']), {**site,
                    'osm_type': charger['osm_type'], 'osm_id': charger['osm_id'],
                    'name': charger['tags'].get('name', ''), 'operator': charger['tags'].get('operator', ''),
                    'access': charger['tags'].get('access', ''),
                    'registry_distance_m': round(charger['geometry'].distance(point), 1),
                    'association_verified': False, 'entrance_verified': False,
                    'target_geometry': 'mapped_node' if charger['osm_type'] == 'node' else 'area_representative_point'}))
            entries, associated = entry_evidence(point, targets, areas, entrances, network, raw_ways)
            for geometry, properties in entries:
                entry_features.append(feature(geographic(geometry), {**site, **properties, 'entrance_verified': False}))
            for area in associated:
                area_features.append(feature(geographic(area['geometry']), {**site, 'osm_type': 'way', 'osm_id': area['osm_id'], 'amenity': area['tags']['amenity'], 'association_verified': False}))
            outcomes = []
            probes = [('registry_coordinate', point, None), *[('osm_charger_candidate', c['geometry'], c) for c in targets]]
            for kind, target, charger in probes:
                traced = trace_match(network, target, context)
                props = {**site, 'target_kind': kind, 'osm_type': charger['osm_type'] if charger else '',
                         'osm_id': charger['osm_id'] if charger else None,
                         'association_distance_m': round(target.distance(point), 1) if charger else None,
                         'association_verified': False, 'entrance_verified': False,
                         'status': 'road_route_found' if traced else 'no_route_within_pilot'}
                if traced:
                    props.update(traced['match'])
                    properties = {k: v for k, v in props.items() if k not in ('arrival_ways', 'departure_ways')}
                    properties['arrival_ways_json'] = json.dumps(props['arrival_ways'])
                    properties['departure_ways_json'] = json.dumps(props['departure_ways'])
                    terminal_features.append(feature(geographic(traced['terminal']), properties))
                    for leg in ('arrival', 'return'):
                        if traced[leg].geom_type == 'LineString':
                            route_features.append(feature(geographic(traced[leg]), {**properties, 'leg': leg}))
                review.append({**props, 'entry_candidates': len(entries), 'mapped_charger_candidates': len(targets)})
                outcomes.append(bool(traced))
            site_features.append(feature(Point(site['longitude'], site['latitude']), {**site,
                                         'road_route_found': outcomes[0], 'mapped_charger_route_found': any(outcomes[1:]),
                                         'mapped_charger_candidates': len(targets), 'entry_candidates': len(entries),
                                         'entrance_verified': False}))
        del network, context
        gc.collect()
    for name, features in [('routes', route_features), ('sites', site_features), ('entry_candidates', entry_features), ('osm_areas', area_features), ('mapped_chargers', charger_features), ('road_terminals', terminal_features)]:
        write_json(output / (name + '.geojson'), {'type': 'FeatureCollection', 'features': features})
    fields = list(dict.fromkeys(k for r in review for k in r))
    with (output / 'site-review.csv').open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in review:
            writer.writerow({k: json.dumps(v) if isinstance(v, (list, dict)) else v for k, v in row.items()})
    summaries = []
    for direction in ('north', 'south'):
        rows = [f['properties'] for f in site_features if f['properties']['direction'] == direction]
        summaries.append({'direction': direction, 'sites': len(rows),
                          'road_route_found': sum(r['road_route_found'] for r in rows),
                          'mapped_charger_route_found': sum(r['mapped_charger_route_found'] for r in rows),
                          'sites_with_entry_candidates': sum(r['entry_candidates'] > 0 for r in rows)})
    summary = {'method': METHOD, 'chain_range_m': [chain_start, chain_end], 'direction': direction, 'source': source,
               'routing_policy': {'approach_m': ACCESS, 'return_m': RETURN, 'snap_m': SNAP},
               'poi_association_radius_m': POI_RADIUS, 'poi_association_verified': False,
               'directions': summaries, 'confirmed_entrances': 0, 'intervals_recalculated': False,
               'startup_sha256': digest(project / 'public/data/charging_sites_startup_zstd10.parquet'),
               'elapsed_seconds': round(time.monotonic() - started, 1)}
    write_json(output / 'audit.json', summary)
    archive = output / 'a5-entry-audit-results.zip'
    from zipfile import ZipFile, ZIP_DEFLATED
    with ZipFile(archive.with_suffix('.zip.part'), 'w', ZIP_DEFLATED) as zipped:
        for name in ('audit.json', 'site-review.csv', 'routes.geojson', 'sites.geojson', 'entry_candidates.geojson', 'osm_areas.geojson', 'mapped_chargers.geojson', 'road_terminals.geojson'):
            zipped.write(output / name, name)
    archive.with_suffix('.zip.part').replace(archive)
    log(json.dumps(summaries, ensure_ascii=False))
    log(f'Done: {archive.resolve()}')
    return summary

