"""Topology/access tests: python -m unittest discover -s tests -p 'test_a9*.py'."""
import importlib.util
import unittest
import json
import tempfile
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
spec = importlib.util.spec_from_file_location('a9', Path(__file__).resolve().parents[1] / 'scripts/prepare_a9.py')
a9 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a9)


class PipelineTest(unittest.TestCase):
    def test_nested_relation_is_not_flattened_by_file_order(self):
        objects = {('relation',1): {'members':[{'type':'relation','ref':2}]},
                   ('relation',2): {'members':[{'type':'way','ref':7},{'type':'way','ref':5}]},
                   ('way',5): {}, ('way',7): {}}
        self.assertEqual(a9.relation_ways(objects,1),[7,5])
        del objects['way',7]
        with self.assertRaises(ValueError): a9.relation_ways(objects,1)

    def test_cycle_fails(self):
        with self.assertRaises(ValueError):
            a9.relation_ways({('relation',1): {'members':[{'type':'relation','ref':1}]}},1)

    def test_unrouted_fast_chargers_do_not_remove_gaps(self):
        candidates = [{'chain_m':30000,'eligible_power':True,'access_status':'unconfirmed'}]
        self.assertEqual(a9.gaps(100000,candidates),[(0.0,100000,'unknown')])

    def test_intervals_exclude_endpoints_and_require_pool_power(self):
        candidates = [{'chain_m':x,'eligible_power':True,'access_status':'road_route_found_entrance_unverified'} for x in [10000,61000,122000]]
        candidates.append({'chain_m':90000,'eligible_power':False,'access_status':'road_route_found_entrance_unverified'})
        self.assertEqual([s for _,_,s in a9.gaps(130000,candidates)],['unknown','near','gap','unknown'])

    def test_cached_links_reject_stale_inputs(self):
        data = a9.ROOT / 'public/data'
        objects = a9.read_objects(a9.ROOT / 'data_sources/a9')
        ids = a9.relation_ways(objects, 20738) + [725303216, 725303217]
        routes = a9.assemble_routes(objects, ids)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            payload = json.loads((a9.ROOT / 'data_sources/a9/access-links.json').read_text())
            payload['binding']['groups_sha256'] = 'stale'
            (source / 'access-links.json').write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, 'do not match'):
                a9.checked_links(source, None, routes, objects, ids,
                                 data / 'charging_sites_startup_zstd10.parquet',
                                 data / 'charging_point_groups_numeric_zstd10.parquet')

    def test_actual_a9_has_two_continuous_directed_paths(self):
        objects = a9.read_objects(a9.ROOT/'data_sources/a9')
        ids = a9.relation_ways(objects,20738)
        # Relation-only input must not silently invent connections over its gaps.
        with self.assertRaises(ValueError): a9.assemble_routes(objects,ids)
        routes = a9.assemble_routes(objects,ids+[725303216,725303217])
        self.assertEqual([r['direction'] for r in routes],['north','south'])
        for route in routes:
            self.assertGreater(route['length_m'],500000)
            self.assertTrue(all(a < b for a,b in zip(route['chain'],route['chain'][1:])))


if __name__ == '__main__': unittest.main()
