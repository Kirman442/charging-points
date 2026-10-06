"""Prepare the A9 pilot from cached OSM JSON. No spatial work is done in the browser.
Requires pyarrow, shapely, pyproj, networkx. Run fetch_a9.py first.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import networkx as nx
import pyarrow as pa
import pyarrow.parquet as pq
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import substring

PROJECT = Transformer.from_crs(4326, 32632, always_xy=True)
UNPROJECT = Transformer.from_crs(32632, 4326, always_xy=True)
ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_objects(source):
    objects = {}
    for path in sorted(source.glob('*.json')):
        if path.name in ('access-network.json', 'access-links.json', 'audit.json'):
            continue
        for obj in json.loads(path.read_text())['elements']:
            key = (obj['type'], obj['id'])
            if key not in objects or obj.get('version', 0) >= objects[key].get('version', 0):
                objects[key] = obj
    return objects


def relation_ways(objects, relation_id, stack=()):
    if relation_id in stack:
        raise ValueError('Cyclic relation hierarchy')
    relation = objects.get(('relation', relation_id))
    if relation is None:
        raise ValueError(f'Missing relation {relation_id}')
    result = []
    for member in relation['members']:
        if member['type'] == 'relation':
            result.extend(relation_ways(objects, member['ref'], (*stack, relation_id)))
        elif member['type'] == 'way':
            if ('way', member['ref']) not in objects:
                raise ValueError(f'Missing way {member["ref"]}')
            result.append(member['ref'])
    return result


def coordinate(objects, node):
    obj = objects.get(('node', node))
    if obj is None:
        raise ValueError(f'Missing node {node}')
    return (obj['lon'], obj['lat'])


def assemble_routes(objects, ids):
    graph = nx.DiGraph()
    for way_id in sorted(set(ids)):
        way = objects['way', way_id]
        tags = way.get('tags', {})
        if tags.get('highway') != 'motorway':
            continue
        if tags.get('oneway') not in ('yes', '1', '-1', 'true'):
            raise ValueError(f'A9 way {way_id} needs an explicit direction')
        nodes = way['nodes'][::-1] if tags['oneway'] == '-1' else way['nodes']
        for u, v in zip(nodes, nodes[1:]):
            graph.add_edge(u, v, way_id=way_id)
    routes = []
    for component in nx.weakly_connected_components(graph):
        sub = graph.subgraph(component)
        starts = [n for n in sub if sub.in_degree(n) == 0]
        if len(starts) != 1 or any(sub.in_degree(n) > 1 or sub.out_degree(n) > 1 for n in sub):
            raise ValueError('Ambiguous/looped A9 topology; resolve it before publishing')
        node = starts[0]
        nodes = [node]
        while sub.out_degree(node):
            node = next(iter(sub.successors(node)))
            nodes.append(node)
        if len(nodes) != len(component):
            raise ValueError('Incomplete traversal')
        coords = [coordinate(objects, n) for n in nodes]
        direction = 'north' if coords[-1][1] > coords[0][1] else 'south'
        metric = [PROJECT.transform(*p) for p in coords]
        line = LineString(metric)
        chain = [0.0]
        for a, b in zip(metric, metric[1:]):
            chain.append(chain[-1] + math.dist(a, b))
        routes.append({'direction': direction, 'nodes': nodes, 'chain': chain, 'line': line,
                       'coordinates': coords, 'length_m': line.length})
    # Never turn multiple disconnected paths into one artificial straight line.
    for direction in ('north', 'south'):
        if sum(r['direction'] == direction for r in routes) != 1:
            raise ValueError(f'{direction}: disconnected route; check missing relation ways')
    return sorted(routes, key=lambda r: r['direction'])


def equipment_stats(groups, count):
    powers, fast_points = [0.0] * count, [0] * count
    seen = set()
    for g in groups.to_pylist():
        row, equipment = g['site_row'], g['equipment_index']
        if not 0 <= row < count:
            raise ValueError('Group refers to missing site')
        if equipment not in seen:
            seen.add(equipment)
            powers[row] += g['equipment_power_kw']
        if g['has_dc'] and g['max_power_kw'] >= 150:
            fast_points[row] += g['point_count']
    return powers, fast_points


def checked_links(source, network_path, routes, objects, ids, sites_path, groups_path):
    """Recompute with a road extract, or reuse strictly bound numeric links."""
    from a9_access import Network
    binding = {'startup_sha256': sha(sites_path), 'groups_sha256': sha(groups_path),
               'route_sha256': hashlib.sha256(json.dumps(
                   [{'direction': r['direction'], 'nodes': r['nodes'], 'coordinates': r['coordinates']}
                    for r in routes], sort_keys=True).encode()).hexdigest()}
    cache = source / 'access-links.json'
    if network_path is None:
        if not cache.exists():
            return {}, None
        payload = json.loads(cache.read_text())
        if payload.get('format') != 'a9-access-links-v1' or payload.get('binding') != binding:
            raise ValueError('Cached road links do not match sites, groups or route geometry')
    else:
        raw = json.loads(network_path.read_text())
        network = Network(raw['elements'])
        missing = {n for r in routes for n in r['nodes']} - network.coords.keys()
        if missing:
            raise ValueError('Road network is missing A9 route nodes')
        sites = pq.read_table(sites_path)
        coords = list(zip(sites['longitude'].to_pylist(), sites['latitude'].to_pylist()))
        matches = []
        for route in routes:
            context = network.search(route, objects, ids)
            for row, xy in enumerate(coords):
                point = Point(PROJECT.transform(*xy))
                if route['line'].distance(point) > 3500:
                    continue
                match = network.match(point, context)
                if match:
                    matches.append({'site_row': row, 'direction': route['direction'], **match})
        payload = {'format': 'a9-access-links-v1', 'binding': binding, 'matches': matches,
                   'source': raw.get('source'), 'network_sha256': sha(network_path),
                   'routing': {'max_access_m': 3000, 'max_return_m': 10000, 'max_snap_m': 60},
                   'restrictions': dict(network.restriction_counts)}
        cache.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
    links = {}
    count = pq.read_metadata(sites_path).num_rows
    lengths = {r['direction']: r['length_m'] for r in routes}
    for m in payload['matches']:
        key = (m['direction'], m['site_row'])
        if (m['direction'] not in lengths or not isinstance(m['site_row'], int)
                or not 0 <= m['site_row'] < count or key in links
                or not 0 <= m['chain_m'] <= lengths[m['direction']]
                or not 0 <= m['access_m'] <= 3000 or not 0 <= m['return_m'] <= 10000
                or not 0 <= m['snap_m'] <= 60):
            raise ValueError('Invalid or duplicate checked road link')
        links[key] = m
    return links, payload


def gaps(length, candidates):
    # Exploratory infrastructure intervals, not a legal compliance verdict.
    positions = sorted(set(c['chain_m'] for c in candidates if c['eligible_power'] and c['access_status'] == 'road_route_found_entrance_unverified'))
    if not positions:
        return [(0.0, length, 'unknown')]
    boundaries = [0.0, *positions, length]
    result = []
    for index, (a, b) in enumerate(zip(boundaries, boundaries[1:])):
        if b <= a:
            continue
        status = 'unknown' if index == 0 or index == len(boundaries)-2 else 'gap' if b-a > 60000 else 'near' if b-a > 50000 else 'within'
        result.append((a, b, status))
    return result


def prepare(source, data_dir, network_path=None):
    objects = read_objects(source)
    ids = relation_ways(objects, 20738)
    # Explicit, audited membership repairs; only the two observed missing A9 ways.
    repairs = [725303216, 725303217]
    for i in repairs:
        if ('way', i) not in objects or objects['way', i].get('tags', {}).get('ref') != 'A 9':
            raise ValueError(f'Missing audited repair {i}')
    routes = assemble_routes(objects, [*ids, *repairs])
    sites_path = data_dir / 'charging_sites_startup_zstd10.parquet'
    groups_path = data_dir / 'charging_point_groups_numeric_zstd10.parquet'
    catalog = pq.read_table(data_dir / 'charging_runtime_catalog_zstd10.parquet')
    sites, groups = pq.read_table(sites_path), pq.read_table(groups_path)
    meta = catalog.schema.metadata
    if meta[b'startup_sites_sha256'].decode() != sha(sites_path) or meta[b'numeric_groups_sha256'].decode() != sha(groups_path):
        raise ValueError('Runtime inputs do not match catalog')
    powers, fast = equipment_stats(groups, sites.num_rows)
    coords = list(zip(sites['longitude'].to_pylist(), sites['latitude'].to_pylist()))
    links, access_audit = checked_links(source, network_path, routes, objects, [*ids, *repairs], sites_path, groups_path)
    rows, summaries, review = [], [], []
    for route in routes:
        candidates = []
        direction, line = route['direction'], route['line']
        for row, xy in enumerate(coords):
            point = Point(PROJECT.transform(*xy))
            if line.distance(point) > 3500:
                continue
            access = links.get((direction, row))
            chain = access['chain_m'] if access else line.project(point)
            c = {'site_row': row, 'longitude': xy[0], 'latitude': xy[1], 'direction': direction,
                 'chain_m': chain, 'power_kw': powers[row], 'fast_points': fast[row],
                 'eligible_power': powers[row] >= 400 and fast[row] >= 1,
                 'access_status': 'road_route_found_entrance_unverified' if access else 'unconfirmed',
                 'access_m': access['access_m'] if access else None, 'return_m': access['return_m'] if access else None,
                 'snap_m': access['snap_m'] if access else None}
            candidates.append(c)
        intervals = gaps(line.length, candidates)
        for a, b, status in intervals:
            segment = substring(line, a, b)
            coordinates = [UNPROJECT.transform(*p) for p in segment.coords]
            rows.append({'kind': 'segment', 'direction': direction, 'site_row': None,
                         'geometry_json': json.dumps(coordinates, separators=(',', ':')), 'chain_m': a, 'end_m': b,
                         'gap_km': (b-a)/1000, 'status': status, 'power_kw': None, 'fast_points': None,
                         'access_m': None, 'return_m': None, 'eligible_power': None, 'snap_m': None})
        for c in candidates:
            rows.append({'kind': 'site', 'direction': direction, 'site_row': c['site_row'],
                         'geometry_json': json.dumps([c['longitude'], c['latitude']]), 'chain_m': c['chain_m'], 'end_m': None,
                         'gap_km': None, 'status': c['access_status'], 'power_kw': c['power_kw'], 'fast_points': c['fast_points'],
                         'access_m': c['access_m'], 'return_m': c['return_m'], 'eligible_power': c['eligible_power'], 'snap_m': c['snap_m']})
        known = [b-a for a,b,s in intervals if s != 'unknown']
        summaries.append({'direction': direction, 'length_km': round(line.length/1000, 2),
                          'candidates': len(candidates), 'routed': sum(c['access_status']=='road_route_found_entrance_unverified' for c in candidates),
                          'fast_routed': sum(c['fast_points'] > 0 and c['access_status']=='road_route_found_entrance_unverified' for c in candidates),
                          'eligible_routed': sum(c['eligible_power'] and c['access_status']=='road_route_found_entrance_unverified' for c in candidates),
                          'max_gap_km': round(max(known)/1000, 1) if known else None})
        review.extend(candidates)
    metadata = {'format': 'a9-pilot-v2', 'startup_sites_sha256': sha(sites_path), 'site_count': str(sites.num_rows),
                'route': 'A 9', 'relation_id': '20738', 'membership_repairs': json.dumps(repairs),
                'source_date': str(sites['source_date'][0].as_py()), 'directions': json.dumps(summaries),
                'access_network': str(access_audit is not None).lower(),
                'access_source': json.dumps(access_audit.get('source')) if access_audit else 'null',
                'access_network_sha256': access_audit['network_sha256'] if access_audit else '',
                'access_links_sha256': sha(source / 'access-links.json') if access_audit else '', 'assessment': 'exploratory-not-legal-compliance',
                'osm_sha256': json.dumps({p.name: sha(p) for p in sorted(source.glob('*.json')) if p.name not in ('audit.json', 'access-network.json')})}
    schema = pa.schema([('kind', pa.string()), ('direction', pa.string()), ('site_row', pa.uint32()),
                        ('geometry_json', pa.string()), ('chain_m', pa.float64()), ('end_m', pa.float64()),
                        ('gap_km', pa.float64()), ('status', pa.string()), ('power_kw', pa.float64()),
                        ('fast_points', pa.uint32()), ('access_m', pa.float64()), ('return_m', pa.float64()),
                        ('eligible_power', pa.bool_()), ('snap_m', pa.float64())], metadata={k.encode():v.encode() for k,v in metadata.items()})
    table = pa.Table.from_pylist(rows, schema=schema)
    output = data_dir / 'autobahn_a9_zstd10.parquet'
    pq.write_table(table, output, compression='zstd', compression_level=10)
    if not pq.read_table(output).equals(table):
        raise ValueError('Parquet round-trip changed data')
    report = {**metadata, 'directions': summaries, 'bytes': output.stat().st_size,
              'limitations': ['Actual site entrances are unverified; complex/conditional restrictions are conservatively excluded',
                             'Address groups are not certified AFIR charging pools',
                             'TEN-T classification, exceptions and route endpoints are not certified']}
    (source / 'audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    import csv
    with (source / 'site-review.csv').open('w') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(review[0]))
        writer.writeheader(); writer.writerows(review)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'data_sources/a9')
    parser.add_argument('--data', type=Path, default=ROOT / 'public/data')
    parser.add_argument('--network', type=Path, help='External road extract JSON; recomputes checked links')
    args = parser.parse_args()
    prepare(args.source, args.data, args.network)
