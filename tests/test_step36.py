import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from step35_evidence import save, read
from step36_registry_equipment import enrich


class RegistryComparisonTests(unittest.TestCase):
    def test_installation_power_is_counted_once_and_connector_types_compared(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            save(root / 'shared-groups.json', [{'route': 'A5', 'osm_type': 'node', 'osm_id': 1,
                'osm_sockets': {'socket:type2_combo': '2'}, 'osm_powers_kw': [350], 'osm_refs': {},
                'candidates': [{'site_id': 'site-1', 'site_row': 0, 'review_priority': 0, 'power_kw': 350, 'fast_points': 2}]}])
            row = {'site_id': 'site-1', 'equipment_id': 'device-1', 'equipment_type': 'Schnellladeeinrichtung',
                   'equipment_power_kw': 350., 'equipment_point_count': 2,
                   'connector_types': ['DC Fahrzeugkupplung Typ Combo 2 (CCS)'],
                   'connector_powers_kw': [350.], 'max_power_kw': 350., 'has_dc': True}
            points = root / 'points.parquet'; pq.write_table(pa.Table.from_pylist([row, row]), points)
            result = enrich(root, points)
            self.assertEqual(result['comparisons'], 1)
            c = read(root / 'registry-equipment-comparison.json')['comparisons'][0]
            self.assertEqual(c['installed_power_kw'], 350)
            self.assertEqual(c['point_count'], 2)
            self.assertEqual(c['common_connector_families'], ['ccs'])
            self.assertFalse(c['association_verified'])
