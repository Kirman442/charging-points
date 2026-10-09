"""Export the reproduced road model with separate saved access evidence.

No PBF scan, graph construction or route search. Existing model fields and
intervals must round-trip unchanged; OSM candidate routes never become inputs.
"""
import argparse
import csv
import json
import math
import hashlib
import shutil
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq


def digest(path):
    with Path(path).open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()


def validate_intervals(rows, route):
    sites = [r for r in rows if r['kind'] == 'site']
    segments = [r for r in rows if r['kind'] == 'segment']
    checked = 0
    for direction, section in {(r['direction'], r['section']) for r in rows}:
        parts = sorted([r for r in segments if r['direction'] == direction and r['section'] == section], key=lambda r: r['chain_m'])
        if not parts or parts[0]['chain_m'] != 0: raise ValueError('Incomplete section coverage')
        eligible = [r for r in sites if r['direction'] == direction and r['section'] == section and r['status'] == 'road_route_found_entrance_unverified' and r['power_kw'] >= 400 and r['fast_points'] > 0]
        for i, s in enumerate(parts):
            if i and abs(parts[i-1]['end_m'] - s['chain_m']) > 1e-8: raise ValueError('Segment discontinuity')
            if not math.isclose(s['road_gap_km'], (s['end_m']-s['chain_m'])/1000, abs_tol=1e-8): raise ValueError('Road geometry distance differs')
            before = [x for x in eligible if abs(x['chain_m'] - s['chain_m']) < 1e-8]
            after = [x for x in eligible if abs(x['chain_m'] - s['end_m']) < 1e-8]
            distances = [(a['return_m'] + b['chain_m'] - a['entry_chain_m'] + b['access_m'])/1000 for a in before for b in after if a['entry_chain_m'] <= b['chain_m']]
            if s['status'] == 'unknown':
                if distances: raise ValueError('Compatible interval incorrectly unknown')
            else:
                if not distances or not math.isclose(s['gap_km'], min(distances), abs_tol=1e-8): raise ValueError('Return + motorway + approach formula differs')
                status = 'gap' if s['gap_km'] > 60 else 'near' if s['gap_km'] > 50 else 'within'
                if s['status'] != status: raise ValueError('Interval class differs')
                checked += 1
            if route == 'A1':
                coords = json.loads(s['geometry_json'])
                if section not in ('northern', 'southern') or any(p[1] < 50.45 if section == 'northern' else p[1] > 50.28 for p in coords): raise ValueError('A1 physical gap crossed')
    if route == 'A1' and {(r['direction'], r['section']) for r in segments} != {(d, s) for d in ('north', 'south') for s in ('northern', 'southern')}: raise ValueError('A1 sections differ')
    return checked


def finalize(project, source, output):
    project = Path(project).resolve(); source = Path(source).resolve(); output = Path(output).resolve()
    if output == source or output.is_relative_to(source) or output.is_relative_to(project): raise ValueError('Keep release report separate from source/project')
    if (output / 'release-audit.json').exists(): raise ValueError('Release already exists; preserve it')
    output.mkdir(parents=True, exist_ok=True)
    backup = output / 'before-release'; backup.mkdir(exist_ok=True)
    prepared = []; report = {}
    for route in ('A5', 'A1', 'A9'):
        path = project / f'public/data/autobahn_{route.lower()}_zstd10.parquet'
        folder = source / route.lower()
        audit_path = source.parent / '34_step_a5_full_entry_review/audit.json' if route == 'A5' else folder / 'audit.json'
        audit = json.loads(audit_path.read_text(encoding='utf-8-sig'))
        if digest(path) != audit['pilot_sha256']: raise ValueError(f'{route}: original pilot differs from reproduced input')
        if digest(project / 'public/data/charging_sites_startup_zstd10.parquet') != audit['registry_hashes']['sites_startup']: raise ValueError('Registry changed')
        table = pq.read_table(path); rows = table.to_pylist(); md = dict(table.schema.metadata)
        if md.get(b'routing_policy') != b'pilot-3km-out-3km-back-v1': raise ValueError('Wrong routing policy')
        known = validate_intervals(rows, route)
        with (folder / 'review-queue.csv').open(encoding='utf-8-sig', newline='') as f:
            queue = {(int(r['site_row']), r['direction']): r for r in csv.DictReader(f)}
        checks = json.loads((folder / 'path-checks-enriched.json').read_text(encoding='utf-8-sig'))
        own = {}
        for c in checks:
            if c['target_kind'] == 'registry_coordinate': own.setdefault((c['site_row'], c['direction']), []).append(c)
        conditions = []; evidence = []; site_ids = []; flagged = {}; totals = []
        for r in rows:
            if r['kind'] != 'site': conditions.append(None); evidence.append(None); site_ids.append(None); continue
            key = r['site_row'], r['direction']; q = queue.get(key)
            if q is None: raise ValueError('Reproduced site missing')
            good = r['status'] == 'road_route_found_entrance_unverified'
            if good != (q['road_route_found'].lower() == 'true'): raise ValueError('Registry route reproduction differs')
            if good and not (0 <= r['access_m'] <= 3000 and 0 <= r['return_m'] <= 3000 and 0 <= r['snap_m'] <= 60): raise ValueError('Route exceeds model policy')
            restrictions = json.loads(q['registry_path_restrictions'])
            legs = own.get(key, [])
            checked = good and {c['leg'] for c in legs} == {'arrival', 'return'} and all(c.get('all_traversed_way_tags_checked') for c in legs)
            conditions.append(json.dumps(restrictions, ensure_ascii=False, separators=(',', ':')))
            evidence.append(checked); site_ids.append(q['site_id'])
            if good and restrictions: flagged[r['direction']] = flagged.get(r['direction'], 0) + 1
        if set(queue) != {(r['site_row'], r['direction']) for r in rows if r['kind'] == 'site'}: raise ValueError('Candidate coverage differs')
        enhanced = table.append_column('access_conditions_json', pa.array(conditions, type=pa.string())).append_column('access_evidence_checked', pa.array(evidence, type=pa.bool_())).append_column('registry_site_id', pa.array(site_ids, type=pa.string()))
        md.update({b'assessment': b'road-model-accessibility', b'access_evidence': b'step35-own-registry-paths-v1', b'original_model_sha256': digest(path).encode(), b'step35_review_sha256': digest(folder / 'review-queue.csv').encode(), b'physical_entrances_verified': b'false'})
        enhanced = enhanced.replace_schema_metadata(md)
        candidate = output / path.name
        pq.write_table(enhanced, candidate, compression='zstd', compression_level=10)
        restored = pq.read_table(candidate)
        if not restored.select(table.column_names).equals(table, check_metadata=False): raise ValueError('Existing model changed during export')
        if not restored.equals(enhanced, check_metadata=True): raise ValueError('Export round-trip differs')
        for direction in ('north', 'south'):
            rr = [r for r in rows if r['kind'] == 'site' and r['direction'] == direction]
            routed = [r for r in rr if r['status'] == 'road_route_found_entrance_unverified']
            totals.append({'direction': direction, 'routed': len(routed), 'fast_routed': sum(r['fast_points'] > 0 for r in routed), 'eligible_routed': sum(r['power_kw'] >= 400 and r['fast_points'] > 0 for r in routed), 'unresolved': sum(r['status'] == 'unconfirmed' for r in rr), 'max_gap_km': round(max(r['gap_km'] for r in rows if r['kind'] == 'segment' and r['direction'] == direction and r['status'] != 'unknown'), 1), 'access_condition_cases': flagged.get(direction, 0)})
        shutil.copy2(path, backup / path.name)
        report[route] = {'before_sha256': digest(path), 'after_sha256': digest(candidate), 'known_intervals_checked': known, 'directions': totals, 'model_columns_unchanged': True, 'step35_queue_sha256': digest(folder / 'review-queue.csv')}
        prepared.append((candidate, path))
    # All three exports are validated before any browser asset is replaced.
    for candidate, path in prepared:
        staging = path.with_suffix('.parquet.part'); shutil.copy2(candidate, staging); staging.replace(path)
    result = {'routing_performed': False, 'pbf_read': False, 'routes': report, 'code_sha256': digest(Path(__file__))}
    (output / 'release-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--source', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); print(json.dumps(finalize(args.project, args.source, args.output), ensure_ascii=False, indent=2))
