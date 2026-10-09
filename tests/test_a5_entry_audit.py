import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import osmium
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from a5_entry_audit import trace_match, entry_evidence, pois, directed_elements
from entry_road_access import Network, PROJECT
from extract_entry_network import extract


def fixture():
    coordinates = {1: (11, 50.001), 2: (11, 50), 3: (11.002, 50),
                   4: (11.002, 50.001), 10: (11.001, 49.999)}
    nodes = [{'type': 'node', 'id': n, 'lon': p[0], 'lat': p[1]} for n, p in coordinates.items()]
    ways = [{'type': 'way', 'id': 100, 'nodes': [1, 2, 3, 4], 'tags': {'highway': 'motorway', 'oneway': 'yes', 'ref': 'A 5'}},
            {'type': 'way', 'id': 200, 'nodes': [2, 10], 'tags': {'highway': 'service', 'service': 'driveway', 'oneway': 'yes'}},
            {'type': 'way', 'id': 201, 'nodes': [10, 3], 'tags': {'highway': 'service', 'service': 'driveway', 'oneway': 'yes'}}]
    return nodes + ways


def context(elements):
    network = Network(elements)
    objects = {(o['type'], o['id']): o for o in elements}
    route = {'nodes': [1, 2, 3, 4], 'chain': [0, 100, 200, 300]}
    return network, network.search(route, objects, [100])


class EntryAuditTests(unittest.TestCase):
    def test_road_area_boundary_is_not_a_driving_way(self):
        data = fixture()
        data[-1]['tags']['area'] = 'yes'
        network, search = context(directed_elements(data, {'way_ids': [100]}))
        self.assertIsNone(trace_match(network, Point(PROJECT.transform(11.001, 49.999)), search))

    def test_geometry_distances_equal_network_distances_and_do_not_bridge_snap(self):
        network, search = context(fixture())
        edge = next(e for e in network.edges if e['way'] == 200)
        on_road = edge['line'].interpolate(edge['length'] * 0.6)
        point = Point(on_road.x - 5, on_road.y - 5)
        result = trace_match(network, point, search)
        self.assertIsNotNone(result)
        self.assertLess(abs(result['arrival'].length - result['match']['access_m']), 0.11)
        self.assertLess(abs(result['return'].length - result['match']['return_m']), 0.11)
        self.assertGreater(result['terminal'].distance(point), 1)
        self.assertEqual(tuple(result['arrival'].coords[-1]), tuple(result['return'].coords[0]))
        self.assertNotEqual(tuple(result['arrival'].coords[-1]), (point.x, point.y))

    def test_private_driveway_does_not_generate_route(self):
        data = fixture()
        data[-1]['tags']['access'] = 'private'
        network, search = context(data)
        self.assertIsNone(trace_match(network, Point(PROJECT.transform(11.001, 49.999)), search))

    def test_foot_entrance_off_driving_graph_is_not_a_vehicle_entry_candidate(self):
        data = fixture()
        data.append({'type': 'node', 'id': 999, 'lon': 11.001, 'lat': 49.999, 'tags': {'entrance': 'main'}})
        network, search = context(data)
        chargers, areas, entrances = pois(data, network.coords)
        found, _ = entry_evidence(Point(network.coords[999]), chargers, areas, entrances, network,
                                  {o['id']: o for o in data if o['type'] == 'way'})
        self.assertEqual(found, [])

    def test_parking_boundary_crossing_is_candidate_and_never_verified(self):
        data = fixture()
        network, search = context(data)
        point = Point(PROJECT.transform(11.001, 49.999))
        polygon = Polygon([(point.x-30, point.y-30), (point.x+30, point.y-30),
                           (point.x+30, point.y+30), (point.x-30, point.y+30)])
        areas = [{'osm_id': 500, 'geometry': polygon, 'tags': {'amenity': 'parking'}}]
        found, associated = entry_evidence(point, [], areas, [], network,
                                          {o['id']: o for o in data if o['type'] == 'way'})
        self.assertTrue(found)
        self.assertEqual(len(associated), 1)
        self.assertTrue(all(not properties['association_verified'] for _, properties in found))

    def test_pbf_extraction_keeps_mapped_charger_and_parking_polygon(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pbf = root / 'sample.osm.pbf'
            writer = osmium.SimpleWriter(str(pbf))
            data = fixture()
            extra = [{'type': 'node', 'id': 30, 'lon': 11.0009, 'lat': 49.9989},
                     {'type': 'node', 'id': 31, 'lon': 11.0011, 'lat': 49.9989},
                     {'type': 'node', 'id': 32, 'lon': 11.0011, 'lat': 49.9991},
                     {'type': 'node', 'id': 33, 'lon': 11.0009, 'lat': 49.9991}]
            for obj in data + extra:
                if obj['type'] == 'node':
                    tags = {'amenity': 'charging_station'} if obj['id'] == 10 else {}
                    writer.add_node(osmium.osm.mutable.Node(id=obj['id'], location=(obj['lon'], obj['lat']), tags=tags))
            for obj in data:
                if obj['type'] == 'way':
                    writer.add_way(osmium.osm.mutable.Way(id=obj['id'], nodes=obj['nodes'], tags=obj['tags']))
            writer.add_way(osmium.osm.mutable.Way(id=500, nodes=[30, 31, 32, 33, 30], tags={'amenity': 'parking'}))
            writer.close()
            extract(pbf, {'A5': MultiLineString([[(11, 50), (11.002, 50)]])}, root / 'network', buffer_km=8, work_dir=root / 'work')
            elements = json.loads((root / 'network/a5/access-network.json').read_text())['elements']
            nodes = {o['id']: PROJECT.transform(o['lon'], o['lat']) for o in elements if o['type'] == 'node'}
            chargers, areas, entrances = pois(elements, nodes)
            self.assertEqual([c['osm_id'] for c in chargers], [10])
            self.assertEqual([a['osm_id'] for a in areas], [500])


if __name__ == '__main__':
    unittest.main()
