"""Precompute browser joins and operator IDs. Requires pyarrow; use after prepare_browser_sites.py."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import pyarrow as pa
import pyarrow.parquet as pq

# ECMAScript whitespace for trim()/\s: match operators.js, not Python's wider \s.
SPACE = re.compile('[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+')


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(sites_path: Path, groups_path: Path, output: Path, catalog_path: Path):
    if len({p.resolve() for p in (sites_path, groups_path, output, catalog_path)}) != 4:
        raise ValueError('Output must be separate from the source files.')
    site_hash, group_hash = fingerprint(sites_path), fingerprint(groups_path)
    sites = pq.read_table(sites_path, columns=['site_id', 'state_name', 'operator', 'opening_hours_type']).to_pydict()
    groups = pq.read_table(groups_path).to_pydict()
    row_by_id = {sid: row for row, sid in enumerate(sites['site_id'])}
    if len(row_by_id) != len(sites['site_id']):
        raise ValueError('Duplicate site IDs.')
    state_names, state_ids, operator_names, operator_ids, operator_sources = [], {}, [], {}, {}
    states, operators, hours = [], [], []
    for state, source, opening in zip(sites['state_name'], sites['operator'], sites['opening_hours_type']):
        if state not in state_ids:
            state_ids[state] = len(state_names)
            state_names.append(state)
        source = str(source or '')
        if source not in operator_sources:
            display = SPACE.sub(' ', unicodedata.normalize('NFC', source)).strip(' ') or 'Оператор не указан'
            key = display.lower()  # German lowercase; deliberately not casefold (ß != ss).
            if key not in operator_ids:
                operator_ids[key] = len(operator_names)
                operator_names.append(display)
            operator_sources[source] = operator_ids[key]
        states.append(state_ids[state])
        operators.append(operator_sources[source])
        hours.append(int(opening == '24_7'))
    equipment_ids, district_ids, codes = {}, {}, []
    rows, equipment, districts = [], [], []
    for sid, eid, code in zip(groups['site_id'], groups['equipment_id'], groups['district_code']):
        if sid not in row_by_id:
            raise ValueError(f'Unknown site ID: {sid}')
        if eid not in equipment_ids:
            equipment_ids[eid] = len(equipment_ids)
        if code not in district_ids:
            district_ids[code] = len(codes)
            codes.append(code)
        rows.append(row_by_id[sid])
        equipment.append(equipment_ids[eid])
        districts.append(district_ids[code])
    if set(rows) != set(range(len(row_by_id))):
        raise ValueError('Every site must have at least one point cohort.')
    metadata = {
        'runtime_format': 'point-groups-v1', 'compression_level': '10',
        'sites_sha256': site_hash, 'source_groups_sha256': group_hash,
        'site_count': str(len(row_by_id)), 'equipment_count': str(len(equipment_ids)),
    }
    fields = [('site_row', pa.uint32()), ('equipment_index', pa.uint32()), ('district_index', pa.uint16()),
              ('max_power_kw', pa.float64()), ('has_dc', pa.uint8()), ('point_count', pa.uint32()),
              ('equipment_power_kw', pa.float64()), ('state_index', pa.uint8()),
              ('operator_index', pa.uint32()), ('site_always_open', pa.uint8())]
    columns = [rows, equipment, districts, groups['max_power_kw'], [int(v) for v in groups['has_dc']],
               groups['point_count'], groups['equipment_power_kw'], [states[r] for r in rows],
               [operators[r] for r in rows], [hours[r] for r in rows]]
    schema = pa.schema(fields, metadata={k.encode(): v.encode() for k, v in metadata.items()})
    table = pa.Table.from_arrays([pa.array(values, type=typ) for values, (_, typ) in zip(columns, fields)], schema=schema)
    if fingerprint(sites_path) != site_hash or fingerprint(groups_path) != group_hash:
        raise ValueError('Source files changed during preparation; retry.')
    output.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, output, compression='zstd', compression_level=10, row_group_size=65536,
                   use_dictionary=['district_index', 'max_power_kw', 'has_dc', 'point_count',
                                   'equipment_power_kw', 'state_index', 'operator_index', 'site_always_open'])
    if not pq.read_table(output).equals(table):
        raise ValueError('Output round-trip changed the table.')
    # Keep the large operator dictionary in a compressed Parquet column, not
    # duplicated, uncompressed footer metadata.
    catalog_metadata = dict(metadata, numeric_groups_sha256=fingerprint(output),
                            district_codes=json.dumps(codes, ensure_ascii=False),
                            state_names=json.dumps(state_names, ensure_ascii=False))
    catalog = pa.table({'operator_name': pa.array(operator_names, type=pa.string())}).replace_schema_metadata(
        {k.encode(): v.encode() for k, v in catalog_metadata.items()})
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(catalog, catalog_path, compression='zstd', compression_level=10)
    if not pq.read_table(catalog_path).equals(catalog):
        raise ValueError('Catalog round-trip changed the table.')
    print(f'{table.num_rows} cohorts, {len(row_by_id)} sites, {len(equipment_ids)} installations, '
          f'{len(operator_names)} operators; {groups_path.stat().st_size:,} -> '
          f'{output.stat().st_size:,} + {catalog_path.stat().st_size:,} bytes')


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / 'public/data'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sites', type=Path, default=root / 'charging_sites_browser_zstd10.parquet')
    parser.add_argument('--groups', type=Path, default=root / 'charging_point_groups_zstd10.parquet')
    parser.add_argument('--output', type=Path, default=root / 'charging_point_groups_numeric_zstd10.parquet')
    parser.add_argument('--catalog', type=Path, default=root / 'charging_runtime_catalog_zstd10.parquet')
    args = parser.parse_args()
    prepare(args.sites, args.groups, args.output, args.catalog)
