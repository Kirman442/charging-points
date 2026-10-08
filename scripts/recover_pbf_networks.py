"""Recover Step 27's saved SQLite on a working copy; never open locations.idx."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import traceback
from zipfile import ZipFile, ZIP_DEFLATED

import osmium
from extract_pbf_networks import Store, ROOT, log
from pbf_completion import complete, validate, incomplete_restrictions, write_review


def sample_source(store, pbf, routes):
    expected = {}
    for route in routes:
        for kind in ['node', 'way', 'relation']:
            for order in ['ASC', 'DESC']:
                for body, in store.db.execute(
                        f'SELECT body FROM objects WHERE route=? AND kind=? ORDER BY id {order} LIMIT 32',
                        (route, kind)):
                    obj = json.loads(body)
                    expected[kind, obj['id']] = obj
    ids = {k: {ident for kind, ident in expected if kind == k}
           for k in ['node', 'way', 'relation']}
    processor = osmium.FileProcessor(str(pbf))
    timestamp = processor.header.get('osmosis_replication_timestamp') or None
    for kind, bits in [('node', osmium.osm.NODE), ('way', osmium.osm.WAY), ('relation', osmium.osm.RELATION)]:
        processor.with_filter(osmium.filter.IdFilter(ids[kind]).enable_for(bits))
    seen = set()
    log('Checking source PBF against saved samples; no geometry rebuild')
    for obj in processor:
        kind = 'node' if obj.is_node() else 'way' if obj.is_way() else 'relation'
        key = kind, obj.id
        prior = expected[key]
        if kind == 'node':
            matches = abs(prior['lon'] - obj.lon) <= 1e-7 and abs(prior['lat'] - obj.lat) <= 1e-7
        elif kind == 'way':
            matches = prior['nodes'] == [n.ref for n in obj.nodes] and prior['tags'] == dict(obj.tags) and prior.get('version') == obj.version
        else:
            kinds = {'n': 'node', 'w': 'way', 'r': 'relation'}
            matches = prior['tags'] == dict(obj.tags) and prior['members'] == [
                {'type': kinds[m.type], 'ref': m.ref, 'role': m.role} for m in obj.members]
        if not matches:
            raise ValueError(f'Source PBF differs from saved {kind} {obj.id}; do not mix snapshots')
        seen.add(key)
    if seen != set(expected):
        raise ValueError('Sample objects are absent from the source PBF')
    return {'matched_objects': len(seen), 'method': 'first/last 32 objects per kind and route',
            'original_source_sha256_available': False}, timestamp


def recover(pbf, checkpoint, output, routes=None):
    if not pbf.is_file():
        raise ValueError(f'PBF not found: {pbf}')
    original = checkpoint / 'objects.sqlite'
    if not original.is_file():
        raise ValueError(f'Checkpoint database not found: {original}')
    if output.exists():
        raise ValueError(f'Output already exists: {output}. Choose a new --output directory')
    working = checkpoint / 'objects-recovery.sqlite'
    if not working.exists():
        log('Checking original SQLite and copying it; original files stay untouched')
        reader = sqlite3.connect(original.resolve().as_uri() + '?mode=ro', uri=True)
        try:
            result = reader.execute('PRAGMA quick_check').fetchall()
            if result != [('ok',)]:
                raise ValueError(f'Original SQLite check failed: {result[:5]}')
            target = sqlite3.connect(working)
            try:
                reader.backup(target)
            finally:
                target.close()
        finally:
            reader.close()
    store = Store(working, create=False)
    try:
        if store.db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('Recovery SQLite integrity check failed')
        available = [r for r, in store.db.execute('SELECT DISTINCT route FROM objects ORDER BY route')]
        routes = list(dict.fromkeys(routes or available))
        if not routes or any(r not in available for r in routes):
            raise ValueError(f'Checkpoint routes: {available}; requested: {routes}')
        for route in routes:
            log(f'{route}: saved counts {store.counts(route)}')
        before = pbf.stat()
        log('Reading PBF SHA-256 for the recovery checkpoint')
        digest = hashlib.sha256()
        with pbf.open('rb') as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
                digest.update(chunk)
        fingerprint = digest.hexdigest()
        store.db.execute('CREATE TABLE IF NOT EXISTS recovery_meta(key TEXT PRIMARY KEY,value TEXT)')
        prior = store.db.execute("SELECT value FROM recovery_meta WHERE key='pbf_sha256'").fetchone()
        if prior and prior[0] != fingerprint:
            raise ValueError('PBF changed since previous recovery attempt')
        sample, snapshot = sample_source(store, pbf, routes)
        store.db.execute('INSERT OR REPLACE INTO recovery_meta VALUES(?,?)', ('pbf_sha256', fingerprint))
        store.db.commit()
        rounds = complete(store, pbf, routes, log)
        validate(store, routes, log)
        after = pbf.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('PBF changed during recovery')
        output.mkdir(parents=True)
        files = []
        for route in routes:
            dest = output / route.lower()
            dest.mkdir()
            source = {'provider': 'local OSM PBF', 'file': pbf.name, 'bytes': before.st_size,
                      'sha256': fingerprint, 'replication_timestamp': snapshot,
                      'route': route, 'seed': 'existing pilot geometry',
                      'buffer_km': 20, 'buffer_origin': 'Step 27 default; not recorded in legacy SQLite',
                      'source_verification': sample, 'recovered_from_step27': True,
                      'all_restriction_members_present': not incomplete_restrictions(store, route),
                      'incomplete_restrictions': len(incomplete_restrictions(store, route)),
                      'incomplete_restriction_policy': 'block_member_ways'}
            network = dest / 'access-network.json'
            store.export(route, network, source)
            audit = dest / 'pbf-extraction-audit.json'
            audit.write_text(json.dumps({**source, 'counts': store.counts(route),
                                        'closure_passes': rounds,
                                        'all_way_nodes_present': True,
                                        'routing_performed': False}, indent=2), encoding='utf-8')
            files.extend([network, audit])
            review = write_review(store, route, dest)
            if review:
                files.append(review)
            log(f'{route}: exported {network.stat().st_size / 1e6:.1f} MB JSON')
        archive = output / ('road-networks-' + '-'.join(r.lower() for r in routes) + '.zip')
        with ZipFile(archive.with_suffix('.zip.part'), 'w', ZIP_DEFLATED, compresslevel=5) as zipped:
            for file in files:
                zipped.write(file, file.relative_to(output))
        archive.with_suffix('.zip.part').replace(archive)
        log(f'Done: {archive}')
        return archive
    finally:
        store.db.close()
        log(f'Recovery database kept: {working}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', type=Path, required=True)
    parser.add_argument('--resume-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'data_sources/pbf_networks')
    parser.add_argument('--routes', nargs='+', choices=['A1', 'A5', 'A9'])
    args = parser.parse_args()
    try:
        recover(args.pbf, args.resume_dir, args.output, args.routes)
    except Exception as exc:
        traceback.print_exc()
        parser.exit(1, f'Recovery failed: {exc}\nOriginal checkpoint was not deleted.\n')


if __name__ == '__main__':
    main()
