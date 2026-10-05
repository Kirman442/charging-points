"""Split browser sites into startup and background details; run after runtime indexes. Requires pyarrow."""
import argparse
import hashlib
from pathlib import Path
import pyarrow.parquet as pq

STARTUP = ['longitude', 'latitude', 'max_power_kw', 'charging_point_count', 'source_date']
DETAILS = ['site_id', 'city', 'street', 'house_number', 'postal_code', 'state_name', 'operator',
           'district_name', 'equipment_count', 'installed_power_kw', 'charging_point_count',
           'opening_hours_label', 'operating_point_count', 'maintenance_point_count', 'available_power_kw']

def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def prepare(source, startup_path, details_path, catalog_path):
    if len({p.resolve() for p in [source, startup_path, details_path, catalog_path]}) != 4:
        raise ValueError('All input/output paths must be separate.')
    source_hash = fingerprint(source)
    table, catalog = pq.read_table(source), pq.read_table(catalog_path)
    catalog_meta = dict(catalog.schema.metadata or {})
    if catalog_meta.get(b'sites_sha256') != source_hash.encode():
        raise ValueError('Regenerate runtime indexes for this browser sites file first.')
    if table['site_id'].null_count or len(set(table['site_id'].to_pylist())) != table.num_rows:
        raise ValueError('Site IDs must be unique and non-null.')
    metadata = {b'loading_format': b'split-sites-v1', b'source_sites_sha256': source_hash.encode(), b'compression_level': b'10'}
    for columns, output, extra in [(STARTUP, startup_path, {}), (DETAILS, details_path, {b'startup_sites_sha256': None})]:
        if extra:
            extra[b'startup_sites_sha256'] = fingerprint(startup_path).encode()
        result = table.select(columns).replace_schema_metadata({**metadata, **extra})
        output.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(result, output, compression='zstd', compression_level=10, row_group_size=65536, use_dictionary=True)
        if not pq.read_table(output).equals(result):
            raise ValueError('Round-trip changed values or row order.')
    if fingerprint(source) != source_hash:
        raise ValueError('Source changed during preparation.')
    catalog_meta.update({b'startup_sites_sha256': fingerprint(startup_path).encode(), b'details_sha256': fingerprint(details_path).encode()})
    catalog = catalog.replace_schema_metadata(catalog_meta)
    pq.write_table(catalog, catalog_path, compression='zstd', compression_level=10)
    if not pq.read_table(catalog_path).equals(catalog):
        raise ValueError('Catalog round-trip failed.')
    print(f'{table.num_rows} sites; browser {source.stat().st_size:,} bytes -> startup {startup_path.stat().st_size:,} bytes ({len(STARTUP)} columns) + details {details_path.stat().st_size:,} bytes ({len(DETAILS)} columns)')

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / 'public/data'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=root / 'charging_sites_browser_zstd10.parquet')
    parser.add_argument('--startup', type=Path, default=root / 'charging_sites_startup_zstd10.parquet')
    parser.add_argument('--details', type=Path, default=root / 'charging_site_details_zstd10.parquet')
    parser.add_argument('--catalog', type=Path, default=root / 'charging_runtime_catalog_zstd10.parquet')
    args = parser.parse_args()
    prepare(args.source, args.startup, args.details, args.catalog)
