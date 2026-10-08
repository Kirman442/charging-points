"""Extract complete road objects and restriction members from a local OSM PBF.

Existing pilot geometries are extraction seeds, not new directional route proofs.
No routing, eligibility changes or runtime Parquet writes occur here.
"""
import argparse
import hashlib
import json
import math
import sqlite3
import tempfile
import shutil
import gc
import traceback
import time
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import numpy as np
import osmium
import pyarrow.parquet as pq
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString
from shapely import transform as shapely_transform

def transform(fn, geometry):
    return shapely_transform(geometry, lambda coords: np.column_stack(fn(coords[:, 0], coords[:, 1])))
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
DRIVING = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary',
           'primary_link', 'secondary', 'secondary_link', 'tertiary',
           'tertiary_link', 'unclassified', 'residential', 'service',
           'living_street', 'road'}
PROJECT = Transformer.from_crs(4326, 32632, always_xy=True).transform
KINDS = {'n': 'node', 'w': 'way', 'r': 'relation'}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def log(message):
    print(time.strftime('%H:%M:%S'), message, flush=True)


def pilot_geometry(path):
    table = pq.read_table(path, columns=['kind', 'geometry_json'])
    lines = [json.loads(r['geometry_json']) for r in table.to_pylist()
             if r['kind'] == 'segment']
    if not lines or any(len(line) < 2 for line in lines):
        raise ValueError(f'No complete route geometry in {path}')
    for line in lines:
        for lon, lat in line:
            if not (math.isfinite(lon) and math.isfinite(lat)
                    and -180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError(f'Invalid coordinate in {path}')
    # Separate lines preserve A1's real gap; never join their endpoints.
    return MultiLineString(lines)


class Store:
    def __init__(self, path, create=True):
        self.db = sqlite3.connect(path)
        if not create:
            self.db.execute("PRAGMA journal_mode=DELETE")
            self.db.execute("PRAGMA synchronous=FULL")
            return
        self.db.executescript('''
          PRAGMA journal_mode=DELETE;
          PRAGMA synchronous=NORMAL;
          PRAGMA cache_size=-32768;
          CREATE TABLE objects(route TEXT, kind TEXT, id INTEGER, body TEXT,
                               PRIMARY KEY(route,kind,id));
          CREATE TABLE nodetags(id INTEGER PRIMARY KEY, body TEXT);
          CREATE TABLE restrictions(id INTEGER PRIMARY KEY, body TEXT);
          CREATE TABLE rmember(rel INTEGER, kind TEXT, ref INTEGER);
          CREATE INDEX member_ref ON rmember(kind,ref);
        ''')

    def put(self, route, obj):
        self.db.execute('INSERT OR REPLACE INTO objects VALUES(?,?,?,?)',
                        (route, obj['type'], obj['id'], encode(obj)))

    def way(self, route, way, locations=None):
        nodes = []
        for n in way.nodes:
            loc = locations.get(n.ref) if locations is not None else n.location
            if not loc.valid():
                raise ValueError(f'Way {way.id}: missing node {n.ref}')
            nodes.append(('node', n.ref, encode({'type': 'node', 'id': n.ref,
                                                'lon': loc.lon, 'lat': loc.lat})))
        if len(nodes) < 2:
            raise ValueError(f'Way {way.id}: fewer than two nodes')
        self.db.executemany('INSERT OR IGNORE INTO objects VALUES(?,?,?,?)',
                            ((route, *n) for n in nodes))
        self.put(route, {'type': 'way', 'id': way.id, 'version': way.version,
                         'nodes': [n.ref for n in way.nodes], 'tags': dict(way.tags)})

    def counts(self, route):
        return dict(self.db.execute(
            'SELECT kind,count(*) FROM objects WHERE route=? GROUP BY kind', (route,)))

    def closure(self, route):
        # Close over restrictions too: added boundary ways can bring new restrictions.
        while True:
            ids = list(self.db.execute('''
              SELECT DISTINCT r.id,r.body FROM restrictions r
              JOIN rmember m ON m.rel=r.id JOIN objects o
                ON o.route=? AND o.kind=m.kind AND o.id=m.ref
              WHERE NOT EXISTS(SELECT 1 FROM objects x
                WHERE x.route=? AND x.kind='relation' AND x.id=r.id)
            ''', (route, route)))
            if not ids:
                break
            for _, body in ids:
                self.put(route, json.loads(body))
        missing = {'way': set(), 'node': set()}
        for body, in self.db.execute(
                "SELECT body FROM objects WHERE route=? AND kind='relation'", (route,)):
            obj = json.loads(body)
            quarantined = {(m['type'], m['ref']) for m in obj.get('incomplete_members', [])}
            for m in obj['members']:
                if (m['type'], m['ref']) in quarantined:
                    continue
                if m['type'] == 'relation':
                    raise ValueError('Nested restriction relation requires manual completion')
                found = self.db.execute('SELECT 1 FROM objects WHERE route=? AND kind=? AND id=?',
                                        (route, m['type'], m['ref'])).fetchone()
                if not found:
                    missing[m['type']].add(m['ref'])
        return missing

    def export(self, route, destination, source):
        tmp = destination.with_suffix('.json.part')
        with tmp.open('w', encoding='utf-8') as stream:
            stream.write('{"source":' + encode(source) + ',"elements":[')
            first = True
            for kind, ident, body in self.db.execute(
                    'SELECT kind,id,body FROM objects WHERE route=? ORDER BY kind,id', (route,)):
                if kind == 'node':
                    tags = self.db.execute('SELECT body FROM nodetags WHERE id=?', (ident,)).fetchone()
                    if tags:
                        obj = json.loads(body)
                        obj['tags'] = json.loads(tags[0])
                        body = encode(obj)
                if not first:
                    stream.write(',')
                stream.write(body)
                first = False
            stream.write(']}')
        tmp.replace(destination)


def extract(pbf, seeds, output, buffer_km=20, work_dir=None):
    if not pbf.is_file():
        raise ValueError(f'PBF not found: {pbf}')
    if 'sparse_file_array' not in osmium.index.map_types():
        raise ValueError('This pyosmium build has no sparse_file_array disk cache')
    if not 5 <= buffer_km <= 50:
        raise ValueError('Extraction buffer must be between 5 and 50 km')
    if output.exists():
        raise ValueError(f'Output already exists: {output}. Choose another --output directory.')
    corridors = {r: transform(PROJECT, geom).buffer(buffer_km * 1000)
                 for r, geom in seeds.items()}
    checks = {r: prep(g) for r, g in corridors.items()}
    unproject = Transformer.from_crs(32632, 4326, always_xy=True).transform
    bounds = {r: transform(unproject, g).bounds for r, g in corridors.items()}
    source_stat = pbf.stat()
    log('Reading source SHA-256 (local file only)')
    digest = hashlib.sha256()
    with pbf.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    output.parent.mkdir(parents=True, exist_ok=True)
    scratch_parent = Path(work_dir) if work_dir else output.parent
    scratch_parent.mkdir(parents=True, exist_ok=True)
    scratch = tempfile.mkdtemp(prefix="pbf-work-", dir=scratch_parent)
    success = False
    log(f"Checkpoint directory: {scratch}")
    store = Store(Path(scratch) / 'objects.sqlite')
    try:
        cache = Path(scratch) / 'locations.idx'
        processor = osmium.FileProcessor(str(pbf)).with_locations(f'sparse_file_array,{cache}')
        snapshot = processor.header.get('osmosis_replication_timestamp') or None
        # Coordinate cache runs BEFORE this filter; untagged way nodes stay available.
        processor.with_filter(osmium.filter.KeyFilter(
            'highway', 'type', 'barrier', 'access', 'vehicle', 'motor_vehicle',
            'motorcar', 'access:conditional', 'vehicle:conditional',
            'motor_vehicle:conditional', 'motorcar:conditional'))
        log('Pass 1: collecting corridor roads, node tags and restrictions')
        scanned = 0
        for obj in processor:
            if obj.is_node():
                store.db.execute('INSERT OR REPLACE INTO nodetags VALUES(?,?)',
                                 (obj.id, encode(dict(obj.tags))))
            elif obj.is_way():
                if obj.tags.get('highway') not in DRIVING:
                    continue
                if len(obj.nodes) < 2:
                    raise ValueError(f'Degenerate driving way {obj.id}')
                coords = [(n.lon, n.lat) for n in obj.nodes]
                xs, ys = zip(*coords)
                nearby = []
                for route, (a, b, c, d) in bounds.items():
                    if max(xs) >= a and min(xs) <= c and max(ys) >= b and min(ys) <= d:
                        nearby.append(route)
                targets = []
                if nearby:
                    line = transform(PROJECT, LineString(coords))
                    targets = [r for r in nearby if checks[r].intersects(line)]
                for route in targets:
                    store.way(route, obj)
                scanned += 1
                if scanned % 100000 == 0:
                    log(f'Examined {scanned:,} driving ways; selected: '
                        + ', '.join(f'{r}={store.counts(r).get("way", 0):,}' for r in seeds))
                    store.db.commit()
            elif obj.is_relation() and obj.tags.get('type') == 'restriction':
                members = [{'type': KINDS[m.type], 'ref': m.ref, 'role': m.role}
                           for m in obj.members]
                store.db.execute('INSERT INTO restrictions VALUES(?,?)',
                                 (obj.id, encode({'type': 'relation', 'id': obj.id,
                                                  'tags': dict(obj.tags), 'members': members})))
                store.db.executemany('INSERT INTO rmember VALUES(?,?,?)',
                                     ((obj.id, m['type'], m['ref']) for m in members))
        store.db.commit()
        if pbf.stat().st_size != source_stat.st_size or pbf.stat().st_mtime_ns != source_stat.st_mtime_ns:
            raise ValueError('Source changed during extraction; use an unchanged PBF')
        # File cache is only used during the first pass. Complete references
        # from the PBF directly; preserve checkpoints if anything fails.
        del processor
        gc.collect()
        from pbf_completion import complete, validate, incomplete_restrictions, write_review
        rounds = complete(store, pbf, list(seeds), log)
        validate(store, list(seeds), log)
        for route in seeds:
            if not store.counts(route).get('way'):
                raise ValueError(f'No roads extracted for {route}')
        output.mkdir()
        paths = []
        for route in seeds:
            dest = output / route.lower()
            dest.mkdir()
            source = {'provider': 'local OSM PBF', 'file': pbf.name,
                      'bytes': source_stat.st_size, 'sha256': digest.hexdigest(),
                      'replication_timestamp': snapshot, 'route': route,
                      'buffer_km': buffer_km, 'seed': 'existing pilot geometry',
                      'all_restriction_members_present': not incomplete_restrictions(store, route),
                      'incomplete_restrictions': len(incomplete_restrictions(store, route)),
                      'incomplete_restriction_policy': 'block_member_ways' }
            network = dest / 'access-network.json'
            store.export(route, network, source)
            audit = dest / 'pbf-extraction-audit.json'
            audit.write_text(json.dumps({**source, 'counts': store.counts(route),
                                        'closure_passes': rounds,
                                        'routing_performed': False}, indent=2), encoding='utf-8')
            paths.extend([network, audit])
            review = write_review(store, route, dest)
            if review:
                paths.append(review)
            log(f'{route}: {store.counts(route)}; {network.stat().st_size / 1e6:.1f} MB JSON')
        archive = output / ('road-networks-' + '-'.join(r.lower() for r in seeds) + '.zip')
        with ZipFile(archive.with_suffix('.zip.part'), 'w', ZIP_DEFLATED, compresslevel=5) as zipped:
            for path in paths:
                zipped.write(path, path.relative_to(output))
        archive.with_suffix('.zip.part').replace(archive)
        log(f'Done: {archive}')
        success = True
        return archive
    finally:
        store.db.close()
        # Release mmap handles before TemporaryDirectory cleanup, including Windows.
        if 'locations' in locals():
            del locations
        if 'processor' in locals():
            del processor
        gc.collect()
        if success:
            try:
                shutil.rmtree(scratch)
            except OSError as exc:
                log(f'Result is complete; temporary cleanup skipped: {exc}')
        else:
            log(f'Failed extraction checkpoint preserved: {scratch}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', required=True, type=Path)
    parser.add_argument('--routes', nargs='+', choices=['A1', 'A5', 'A9'], default=['A1', 'A9'])
    parser.add_argument('--output', type=Path, default=ROOT / 'data_sources/pbf_networks')
    parser.add_argument('--work-dir', type=Path)
    parser.add_argument('--buffer-km', type=float, default=20)
    args = parser.parse_args()
    try:
        seeds = {r: pilot_geometry(ROOT / f'public/data/autobahn_{r.lower()}_zstd10.parquet')
                 for r in dict.fromkeys(args.routes)}
        extract(args.pbf, seeds, args.output, args.buffer_km, args.work_dir)
    except Exception as exc:
        traceback.print_exc()
        parser.exit(1, f'Extraction failed: {exc}\n')


if __name__ == '__main__':
    main()
