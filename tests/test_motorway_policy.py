import sys,unittest,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from prepare_motorways import intervals,ROOT,POLICY
import pyarrow.parquet as pq

def site(exit,entry,approach,back):
    return dict(chain_m=exit,entry_chain_m=entry,access_m=approach,return_m=back,
                status='road_route_found_entrance_unverified',eligible_power=True)

class PolicyTests(unittest.TestCase):
    def test_side_roads_change_classification(self):
        rows=[site(1000,1000,2000,2000),site(59000,59000,2000,2000)]
        self.assertEqual(intervals(70000,rows)[1],(1000,59000,'gap',62.0))

    def test_actual_entry_controls_motorway_distance(self):
        rows=[site(1000,3000,1500,2500),site(51000,51000,1000,1000)]
        self.assertEqual(intervals(70000,rows)[1],(1000,51000,'near',51.5))

    def test_entry_past_next_exit_is_unknown(self):
        rows=[site(1000,5000,100,100),site(3000,3000,100,100)]
        self.assertEqual(intervals(70000,rows)[1][2],'unknown')

    def test_unconfirmed_candidate_never_shortens_interval(self):
        rows=[site(1000,1000,2000,2000),site(59000,59000,2000,2000)]
        candidate=site(30000,30000,1,1);candidate['status']='unconfirmed'
        self.assertEqual(intervals(70000,rows),intervals(70000,rows+[candidate]))

    def test_all_exports_obey_policy_and_reproduce_intervals(self):
        for route in ['a1','a5','a9']:
            table=pq.read_table(ROOT/'public/data'/f'autobahn_{route}_zstd10.parquet')
            self.assertEqual(table.schema.metadata[b'routing_policy'].decode(),POLICY)
            rows=table.to_pylist();sites=[r for r in rows if r['kind']=='site']
            for s in sites:
                if s['status']=='road_route_found_entrance_unverified':
                    self.assertLessEqual(s['access_m'],3000);self.assertLessEqual(s['return_m'],3000)
                    self.assertLessEqual(s['snap_m'],60)
            for direction,section in {(r['direction'],r['section']) for r in rows}:
                segments=[r for r in rows if r['kind']=='segment' and r['direction']==direction and r['section']==section]
                ss=[r for r in sites if r['direction']==direction and r['section']==section]
                expected=intervals(segments[-1]['end_m'],ss)
                self.assertEqual([(r['chain_m'],r['end_m'],r['status'],r['gap_km']) for r in segments],expected)

if __name__=='__main__':unittest.main()
