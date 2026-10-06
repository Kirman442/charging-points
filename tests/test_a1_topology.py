import sys,unittest,json,tempfile
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from a1_topology import build

class A1TopologyTest(unittest.TestCase):
    def test_four_paths_are_continuous_and_preserve_osm_nodes(self):
        routes,objects,selection=build()
        self.assertEqual({(r['section'],r['direction']) for r in routes},{('northern','north'),('northern','south'),('southern','north'),('southern','south')})
        for r in routes:
            self.assertEqual(len(r['nodes']),len(set(r['nodes'])))
            self.assertTrue(all(a<b for a,b in zip(r['chain'],r['chain'][1:])))
            edges={(a,b) for wid in r['way_ids'] for a,b in zip(objects['way',wid]['nodes'],objects['way',wid]['nodes'][1:])}
            self.assertTrue(all((a,b) in edges for a,b in zip(r['nodes'],r['nodes'][1:])))
        self.assertTrue(all(w not in selection['selected_way_ids'] for w in selection['foreign_upload_ways']))

    def test_eifel_gap_does_not_connect_the_two_sections(self):
        routes,_,_=build()
        north={n for r in routes if r['section']=='northern' for n in r['nodes']}
        south={n for r in routes if r['section']=='southern' for n in r['nodes']}
        self.assertFalse(north & south)
        for r in routes:
            self.assertTrue(600000<r['length_m']<615000 if r['section']=='northern' else 135000<r['length_m']<145000)

    def test_stale_numeric_link_cache_is_rejected_before_output(self):
        import prepare_a1
        root=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            temporary=Path(directory)
            (temporary/'public').mkdir();(temporary/'public/data').symlink_to(root/'public/data',target_is_directory=True)
            source=temporary/'data_sources/a1';source.mkdir(parents=True)
            cache=json.loads((root/'data_sources/a1/access-links.json').read_text())
            cache['binding']['groups_sha256']='stale'
            (source/'access-links.json').write_text(json.dumps(cache))
            with patch.object(prepare_a1,'ROOT',temporary):
                with self.assertRaisesRegex(ValueError,'Stale A1'):
                    prepare_a1.prepare()

if __name__=='__main__':unittest.main()
