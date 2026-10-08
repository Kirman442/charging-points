import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh_autobahn_access import runtime_binding, route_fingerprint
from prepare_a9 import read_objects


class RefreshBindingTests(unittest.TestCase):
    def test_routing_reports_are_not_mistaken_for_raw_core_extracts(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            element = {'type': 'node', 'id': 1, 'lon': 11, 'lat': 50}
            (source / 'node-1-ways.json').write_text(json.dumps({'elements': [element]}))
            (source / 'pbf-extraction-audit.json').write_text(json.dumps({'counts': {'node': 99}}))
            (source / 'exit-zones.json').write_text(json.dumps({'sites': []}))
            self.assertEqual(read_objects(source), {('node', 1): element})

    def test_changed_power_file_is_rejected_before_routing(self):
        with tempfile.TemporaryDirectory() as temp:
            data = Path(temp)
            startup = data / 'charging_sites_startup_zstd10.parquet'
            groups = data / 'charging_point_groups_numeric_zstd10.parquet'
            startup.write_bytes(b'coordinates')
            groups.write_bytes(b'power snapshot')
            metadata = {b'startup_sites_sha256': hashlib.sha256(startup.read_bytes()).hexdigest().encode(),
                        b'numeric_groups_sha256': hashlib.sha256(groups.read_bytes()).hexdigest().encode()}
            pq.write_table(pa.table({'dummy': [1]}).replace_schema_metadata(metadata), data / 'charging_runtime_catalog_zstd10.parquet')
            self.assertEqual(runtime_binding(data)['groups_sha256'], metadata[b'numeric_groups_sha256'].decode())
            groups.write_bytes(b'new power snapshot')
            with self.assertRaisesRegex(ValueError, 'catalog'):
                runtime_binding(data)

    def test_changed_route_nodes_or_direction_invalidate_checkpoint_binding(self):
        route = {'direction': 'north', 'nodes': [1, 2], 'coordinates': [[11, 50], [11, 51]], 'way_ids': [100]}
        fingerprint = route_fingerprint([route])
        self.assertNotEqual(fingerprint, route_fingerprint([{**route, 'nodes': [1, 3]}]))
        self.assertNotEqual(fingerprint, route_fingerprint([{**route, 'direction': 'south'}]))


if __name__ == '__main__':
    unittest.main()
