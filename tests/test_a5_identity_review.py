import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import pyarrow as pa
import pyarrow.parquet as pq
from shapely.geometry import LineString

SPEC = importlib.util.spec_from_file_location('review', Path(__file__).resolve().parents[1] / 'scripts/a5_identity_review.py')
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


class ReviewTests(unittest.TestCase):
    def test_operator_identity_does_not_merge_brand_and_company(self):
        self.assertEqual(review.comparison(' Mainova AG ', 'mainova ag'), 'same_text')
        self.assertEqual(review.comparison('Shell Deutschland GmbH', 'Shell'), 'different_text_review_required')
        self.assertEqual(review.comparison('CUBOS Service GmbH', 'Mainova AG'), 'different_text_review_required')
        self.assertEqual(review.comparison('Mainova AG', ''), 'missing_data')

    def test_partial_way_does_not_include_barrier_after_route_terminal(self):
        geometry = LineString([(0, 0), (10, 0)])
        project = lambda x, y, z=None: (x, y)
        self.assertFalse(review.on_traversed_path(9, {9}, geometry, {'lon': 15, 'lat': 0}, project))
        self.assertTrue(review.on_traversed_path(9, {9}, geometry, {'lon': 5, 'lat': 0}, project))
        self.assertFalse(review.on_traversed_path(9, set(), geometry, {'lon': 5, 'lat': 0}, project))
        self.assertFalse(review.on_traversed_path(9, {9}, geometry, {'lon': 5, 'lat': 2}, project))

    def fixture(self, root):
        data = root / 'project/public/data'
        data.mkdir(parents=True)
        count = max(review.FOCUS) + 1
        startup = pa.table({'longitude': [8.65] * count, 'latitude': [50.2] * count})
        source_meta = {b'source_sites_sha256': b'synthetic-source'}
        sp = data / 'charging_sites_startup_zstd10.parquet'
        pq.write_table(startup.replace_schema_metadata(source_meta), sp)
        start_hash = review.fingerprint(sp)
        details = pa.table({'site_id': [str(i) for i in range(count)], 'operator': ['Mainova AG'] * count,
                            'street': ['Test'] * count, 'house_number': ['1'] * count,
                            'city': ['Test'] * count, 'postal_code': ['00000'] * count,
                            'installed_power_kw': [600.] * count, 'available_power_kw': [[150.]] * count})
        dp = data / 'charging_site_details_zstd10.parquet'
        pq.write_table(details.replace_schema_metadata({**source_meta, b'startup_sites_sha256': start_hash.encode()}), dp)
        cp = data / 'charging_runtime_catalog_zstd10.parquet'
        pq.write_table(pa.table({'operator_name': ['Mainova AG']}).replace_schema_metadata({
            b'startup_sites_sha256': start_hash.encode(), b'details_sha256': review.fingerprint(dp).encode(),
            b'sites_sha256': b'synthetic-source'}), cp)
        previous = root / 'previous'
        previous.mkdir()
        source = {'route': 'A5', 'sha256': 'synthetic-pbf-source'}
        review.save_json(previous / 'audit.json', {'startup_sha256': start_hash, 'source': source})
        fields = ['site_row', 'direction', 'longitude', 'latitude', 'target_kind', 'osm_type', 'osm_id', 'association_distance_m']
        with (previous / 'site-review.csv').open('w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for row in review.FOCUS:
                for direction in ['north', 'south']:
                    writer.writerow(dict(site_row=row, direction=direction, longitude=8.65, latitude=50.2, target_kind='registry_coordinate'))
                    writer.writerow(dict(site_row=row, direction=direction, longitude=8.65, latitude=50.2, target_kind='osm_charger_candidate', osm_type='node', osm_id=1, association_distance_m=5))
        features = [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [8.65, 50.2]},
                     'properties': {'site_row': row, 'direction': direction, 'osm_type': 'node', 'osm_id': 1}}
                    for row in review.FOCUS for direction in ['north', 'south']]
        p = {'site_row': 29402, 'direction': 'north', 'target_kind': 'registry_coordinate', 'osm_type': '',
             'osm_id': None, 'leg': 'arrival', 'arrival_ways_json': '[10]', 'departure_ways_json': '[10]',
             'access_m': 100, 'return_m': 100, 'snap_m': 5}
        route = {'type': 'Feature', 'properties': p, 'geometry': {'type': 'LineString', 'coordinates': [[8.65, 50.2], [8.6501, 50.2]]}}
        for name in ['routes', 'sites', 'mapped_chargers', 'entry_candidates', 'osm_areas', 'road_terminals']:
            review.save_json(previous / (name + '.geojson'), {'type': 'FeatureCollection', 'features':
                features if name == 'mapped_chargers' else [route] if name == 'routes' else []})
        network = previous / 'network.json'
        review.save_json(network, {'source': source, 'elements': [
            {'type': 'node', 'id': 1, 'lon': 8.65, 'lat': 50.2, 'tags': {'operator': 'Mainova AG', 'amenity': 'charging_station'}},
            {'type': 'node', 'id': 2, 'lon': 8.6501, 'lat': 50.2},
            {'type': 'node', 'id': 3, 'lon': 8.6502, 'lat': 50.2, 'tags': {'barrier': 'lift_gate'}},
            {'type': 'way', 'id': 10, 'nodes': [1, 2, 3], 'tags': {'highway': 'service'}}]})
        return root / 'project', previous, network, root / 'output'

    def test_end_to_end_keeps_associations_unverified_and_partial_barrier_untraversed(self):
        with tempfile.TemporaryDirectory() as temp:
            args = self.fixture(Path(temp))
            review.run(*args)
            result = review.read_json(args[3] / 'identity-review.json')
            self.assertEqual(len(result), 4)  # duplicate directions collapsed
            self.assertTrue(all(len(item['shared_with_site_rows']) == 3 for item in result))
            self.assertTrue(all(not item['entrance_verified'] and not item['association_verified'] for item in result))
            checks = review.read_json(args[3] / 'path-checks.json')
            self.assertFalse(checks[0]['nearby_tagged_nodes'][0]['on_traversed_geometry'])
            self.assertTrue((args[3] / '32-a5-identity-review-results.zip').exists())
            self.assertFalse(review.read_json(args[3] / 'audit.json')['intervals_recalculated'])

    def test_reject_changed_registry(self):
        with tempfile.TemporaryDirectory() as temp:
            args = self.fixture(Path(temp))
            path = args[1] / 'audit.json'
            audit = review.read_json(path)
            audit['startup_sha256'] = 'different'
            review.save_json(path, audit)
            with self.assertRaisesRegex(ValueError, 'Registry files'):
                review.run(*args)
            self.assertFalse(args[3].exists())

    def test_reject_changed_network_source(self):
        with tempfile.TemporaryDirectory() as temp:
            args = self.fixture(Path(temp))
            network = review.read_json(args[2])
            network['source']['sha256'] = 'different'
            review.save_json(args[2], network)
            with self.assertRaisesRegex(ValueError, 'different source'):
                review.run(*args)
            self.assertFalse(args[3].exists())


if __name__ == '__main__':
    unittest.main()
