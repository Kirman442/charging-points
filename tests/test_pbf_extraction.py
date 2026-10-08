import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import hashlib
from unittest.mock import patch
import unittest
from zipfile import ZipFile

import osmium
import pyarrow as pa
import pyarrow.parquet as pq
from shapely.geometry import LineString, MultiLineString

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import recover_pbf_networks as RECOVER
from road_access_motorcar import Network
from a9_access import Network as A9Network

SPEC = importlib.util.spec_from_file_location('extract_pbf_networks', Path(__file__).resolve().parents[1] / 'scripts/extract_pbf_networks.py')
EXTRACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXTRACT)


class ExtractionTest(unittest.TestCase):
    def source(self, directory):
        # w20 touches the extraction seed. Restriction 100 brings distant w30;
        # restriction 101 on w30 then brings w40 and a tagged remote via node.
        xml = '''<osm version="0.6">
          <node id="1" lat="50" lon="8" version="1"><tag k="highway" v="motorway_junction"/></node>
          <node id="2" lat="50.01" lon="8" version="1"/>
          <node id="3" lat="50" lon="8.001" version="1"><tag k="barrier" v="gate"/><tag k="motorcar" v="private"/></node>
          <node id="4" lat="50.1" lon="8.4" version="1"><tag k="access:conditional" v="no @ (night)"/></node>
          <node id="5" lat="50.1" lon="8.41" version="1"/>
          <node id="6" lat="50.1" lon="8.42" version="1"/>
          <node id="7" lat="52" lon="10" version="1"/>
          <node id="8" lat="52.01" lon="10" version="1"/>
          <node id="9" lat="50" lon="7.8" version="1"/>
          <node id="10" lat="50" lon="8.2" version="1"/>
          <way id="10" version="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="motorway"/><tag k="ref" v="A 1"/><tag k="oneway" v="yes"/></way>
          <way id="20" version="1"><nd ref="1"/><nd ref="3"/><tag k="highway" v="service"/><tag k="access" v="private"/><tag k="oneway" v="yes"/></way>
          <way id="30" version="1"><nd ref="4"/><nd ref="5"/><tag k="highway" v="service"/></way>
          <way id="40" version="1"><nd ref="5"/><nd ref="6"/><tag k="highway" v="service"/></way>
          <way id="50" version="1"><nd ref="7"/><nd ref="8"/><tag k="highway" v="residential"/></way>
          <way id="60" version="1"><nd ref="9"/><nd ref="10"/><tag k="highway" v="primary"/></way>
          <relation id="100" version="1"><member type="way" ref="20" role="from"/><member type="node" ref="4" role="via"/><member type="way" ref="30" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_right_turn"/></relation>
          <relation id="101" version="1"><member type="way" ref="30" role="from"/><member type="way" ref="40" role="via"/><member type="way" ref="40" role="to"/><tag k="type" v="restriction"/><tag k="restriction:conditional" v="no_straight_on @ (Mo-Fr)"/></relation>
        </osm>'''
        source = directory / 'fixture.osm'
        source.write_text(xml)
        pbf = directory / 'fixture.osm.pbf'
        with osmium.SimpleWriter(str(pbf)) as writer:
            for obj in osmium.FileProcessor(str(source)):
                writer.add(obj)
        return pbf

    def test_geometry_tags_boundary_restrictions_and_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pbf = self.source(root)
            seeds = {'A1': LineString([(8, 50), (8, 50.01)]),
                     'A9': LineString([(10, 52), (10, 52.01)])}
            output = root / 'out'
            archive = EXTRACT.extract(pbf, seeds, output, buffer_km=5)
            a1 = json.loads((output / 'a1/access-network.json').read_text())
            a9 = json.loads((output / 'a9/access-network.json').read_text())
            objects = {(r['type'], r['id']): r for r in a1['elements']}
            self.assertEqual({r['id'] for r in a1['elements'] if r['type'] == 'way'}, {10, 20, 30, 40, 60})
            self.assertEqual({r['id'] for r in a9['elements'] if r['type'] == 'way'}, {50})
            self.assertEqual(objects['node', 3]['tags']['barrier'], 'gate')
            self.assertEqual(objects['node', 4]['tags']['access:conditional'], 'no @ (night)')
            self.assertEqual(objects['way', 20]['tags']['access'], 'private')
            self.assertIn(('relation', 101), objects)
            for obj in objects.values():
                for ident in obj.get('nodes', []):
                    self.assertIn(('node', ident), objects)
                for member in obj.get('members', []):
                    self.assertIn((member['type'], member['ref']), objects)
            self.assertTrue(a1['source']['all_restriction_members_present'])
            with ZipFile(archive) as zipped:
                self.assertIsNone(zipped.testzip())
                self.assertEqual(len(zipped.namelist()), 4)
            self.assertFalse(list(root.glob('pbf-work-*')))
            with self.assertRaisesRegex(ValueError, 'already exists'):
                EXTRACT.extract(pbf, seeds, output, buffer_km=5)

    def test_failure_checkpoint_recovery_without_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pbf = self.source(root)
            seeds = {'A1': LineString([(8, 50), (8, 50.01)]),
                     'A9': LineString([(10, 52), (10, 52.01)])}
            with patch('pbf_completion.complete', side_effect=RuntimeError('boundary failure')):
                with self.assertRaisesRegex(RuntimeError, 'boundary failure'):
                    EXTRACT.extract(pbf, seeds, root / 'out', 5)
            checkpoint = next(root.glob('pbf-work-*'))
            original = checkpoint / 'objects.sqlite'
            before = hashlib.sha256(original.read_bytes()).hexdigest()
            (checkpoint / 'locations.idx').unlink(missing_ok=True)
            archive = RECOVER.recover(pbf, checkpoint, root / 'recovered')
            self.assertTrue(archive.is_file())
            self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), before)
            self.assertTrue((checkpoint / 'objects-recovery.sqlite').exists())
            data = json.loads((root / 'recovered/a1/access-network.json').read_text())
            self.assertEqual({o['id'] for o in data['elements'] if o['type']=='way'}, {10,20,30,40,60})
            self.assertTrue(data['source']['recovered_from_step27'])
            # A different snapshot must be rejected without deleting the original.
            wrong = root / 'wrong.osm.pbf'
            wrong.write_bytes(b'wrong source')
            with self.assertRaisesRegex(ValueError, 'PBF changed'):
                RECOVER.recover(wrong, checkpoint, root / 'retry')
            self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), before)

    def test_missing_restriction_members_are_reported_and_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.source(root)
            xml = (root / 'fixture.osm').read_text().replace(
                '<member type="node" ref="4" role="via"/><member type="way" ref="30" role="to"/>',
                '<member type="node" ref="888" role="via"/><member type="way" ref="999" role="to"/>')
            (root / 'partial.osm').write_text(xml)
            pbf = root / 'partial.osm.pbf'
            with osmium.SimpleWriter(str(pbf)) as writer:
                for obj in osmium.FileProcessor(str(root / 'partial.osm')):
                    writer.add(obj)
            archive = EXTRACT.extract(pbf, {'A1': LineString([(8,50), (8,50.01)])}, root / 'out', 5)
            data = json.loads((root / 'out/a1/access-network.json').read_text())
            rule = next(o for o in data['elements'] if o['type']=='relation')
            self.assertEqual(rule['tags']['restriction'], 'no_right_turn')
            self.assertEqual({(m['type'],m['ref']) for m in rule['incomplete_members']}, {('node',888),('way',999)})
            self.assertTrue(rule['routing_review_required'])
            self.assertEqual(rule['blocked_member_way_ids'], [20,999])
            self.assertFalse(data['source']['all_restriction_members_present'])
            self.assertEqual(data['source']['incomplete_restrictions'], 1)
            for network_class in [Network, A9Network]:
                network = network_class(data['elements'])
                self.assertIn(20, network.review_ways)
                self.assertFalse(any(e['way']==20 for e in network.edges))
                self.assertEqual(network.restriction_counts['incomplete_source_restriction'], 1)
            with ZipFile(archive) as zipped:
                self.assertIn('a1/incomplete-restriction-review.json', zipped.namelist())
            report = json.loads((root / 'out/a1/incomplete-restriction-review.json').read_text())
            self.assertEqual(report['count'], 1)

    def test_gap_not_bridged_in_seed(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'pilot.parquet'
            lines = [[[8, 50], [8, 50.01]], [[8, 50.4], [8, 50.41]]]
            pq.write_table(pa.table({'kind': ['segment', 'segment'],
                                     'geometry_json': [json.dumps(v) for v in lines]}), p)
            geo = EXTRACT.pilot_geometry(p)
            self.assertIsInstance(geo, MultiLineString)
            self.assertEqual(len(geo.geoms), 2)
            self.assertLess(geo.length, 0.03)

    def test_incomplete_pbf_fails_without_success_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'bad.osm.pbf'
            p.write_bytes(b'not a pbf')
            output = Path(tmp) / 'out'
            with self.assertRaises((RuntimeError, ValueError)):
                EXTRACT.extract(p, {'A1': LineString([(8, 50), (8, 50.01)])}, output, 5)
            self.assertFalse(output.exists())
            self.assertTrue(list(Path(tmp).glob('pbf-work-*'))) # Failed checkpoint survives


if __name__ == '__main__':
    unittest.main()
