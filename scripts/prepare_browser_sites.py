"""Create the browser-only site table; requires pyarrow (pip install pyarrow)."""
import argparse
from pathlib import Path
import pyarrow.parquet as pq

# Keep in sync with src/config/siteColumns.js; the dataset tests detect drift.
COLUMNS = [
    'site_id', 'longitude', 'latitude', 'max_power_kw', 'dc_point_count',
    'opening_hours_type', 'source_date', 'available_power_kw',
    'city', 'street', 'house_number', 'postal_code', 'state_name', 'operator',
    'district_name', 'equipment_count', 'installed_power_kw', 'charging_point_count',
    'opening_hours_label', 'operating_point_count', 'maintenance_point_count',
]


def prepare(source: Path, output: Path):
    if source.resolve() == output.resolve():
        raise ValueError('Use a separate output file to retain the complete source.')
    table = pq.read_table(source, columns=COLUMNS)
    metadata = dict(table.schema.metadata or {})
    metadata.update({b'compression_level': b'10', b'purpose': b'browser sites: 21 columns; unchanged values, types and row order'})
    table = table.replace_schema_metadata(metadata)
    output.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, output, compression='zstd', compression_level=10,
                   row_group_size=65536, use_dictionary=True)
    restored = pq.read_table(output)
    if not restored.equals(table):
        raise ValueError('Output round-trip changed the table.')
    print(f'{table.num_rows} rows, {table.num_columns} columns; '
          f'{source.stat().st_size:,} -> {output.stat().st_size:,} bytes')


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=root / 'public/data/charging_sites_zstd10.parquet')
    parser.add_argument('--output', type=Path, default=root / 'public/data/charging_sites_browser_zstd10.parquet')
    args = parser.parse_args()
    prepare(args.input, args.output)
