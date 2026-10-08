import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from road_network_store import RoadStore, index, PROJECT
from test_a5_motorcar import fixture, context


class SpatialRoadStoreTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.source = Path(self.work.name) / 'network.json'
        self.cache = Path(self.work.name) / 'network.sqlite'

    def store(self, elements):
        self.source.write_text(json.dumps({'elements': elements}))
        index(self.source, self.cache)
        store = RoadStore(self.cache)
        self.addCleanup(store.db.close)
        return store

    def test_complete_crossing_ways_preserve_full_network_route(self):
        data = fixture()
        store = self.store(data)
        x, y = PROJECT.transform(11.001, 49.999)
        tile = store.tile((x-1, y-1, x+1, y+1))
        # Both connecting ways cross this tiny window; their far endpoints
        # and the shared motorway coordinates must still be available.
        ids = {o['id'] for o in tile if o['type'] == 'node'}
        self.assertTrue({2, 3, 10}.issubset(ids))
        core = [o for o in data if o['type'] == 'way' and o['id'] in (100, 101)]
        present = {(o['type'], o['id']) for o in tile}
        tile += [o for o in data if o['type'] == 'node' and ('node', o['id']) not in present]
        tile += [o for o in core if ('way', o['id']) not in present]
        full, full_context, point = context(data)
        local, local_context, _ = context(tile)
        self.assertEqual(full.match(point, full_context), local.match(point, local_context))

    def test_quarantined_restriction_still_blocks_present_member_in_tile(self):
        data = fixture()
        restriction = {'type': 'relation', 'id': 900,
                       'tags': {'type': 'restriction', 'restriction': 'no_left_turn'},
                       'routing_review_required': True,
                       'incomplete_members': [{'type': 'way', 'ref': 999, 'role': 'from'}],
                       'members': [{'type': 'way', 'ref': 999, 'role': 'from'},
                                   {'type': 'node', 'ref': 10, 'role': 'via'},
                                   {'type': 'way', 'ref': 201, 'role': 'to'}]}
        store = self.store([*data, restriction])
        x, y = PROJECT.transform(11.001, 49.999)
        tile = store.tile((x-2000, y-2000, x+2000, y+2000))
        self.assertIn(restriction, tile)
        network, search, point = context(tile)
        self.assertIn(201, network.review_ways)
        self.assertIsNone(network.match(point, search))

    def test_cache_cannot_be_reused_for_changed_network(self):
        self.store(fixture())
        index(self.source, self.cache)
        self.source.write_text(json.dumps({'elements': fixture(), 'changed': True}))
        with self.assertRaises(ValueError):
            index(self.source, self.cache)

    def test_missing_geometry_never_creates_ready_cache(self):
        data = [o for o in fixture() if not (o['type'] == 'node' and o['id'] == 10)]
        self.source.write_text(json.dumps({'elements': data}))
        with self.assertRaises(KeyError):
            index(self.source, self.cache)
        with self.assertRaises(ValueError):
            index(self.source, self.cache)


if __name__ == '__main__':
    unittest.main()
