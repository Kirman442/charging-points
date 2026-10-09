import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from a5_full_chunk_audit import in_chunk
from a5_full_evidence_report import operator_status,output_powers
from a5_full_entry_review import run,digest
from test_a5_full_paths import fixture


class FullReviewTests(unittest.TestCase):
    def test_chunk_boundary_is_owned_once(self):
        for x in [0,49_999,50_000,99_999,100_000]:
            self.assertEqual(sum(in_chunk(x,a,b,100_000) for a,b in [(0,50_000),(50_000,100_000)]),1)

    def test_operator_names_and_equipment_levels_remain_separate(self):
        self.assertEqual(operator_status('Mainova AG',' mainova ag '),'same_text')
        self.assertEqual(operator_status('CUBOS Service GmbH','Mainova AG'),'different_text_review_required')
        self.assertEqual(operator_status('Shell Deutschland GmbH','Shell'),'different_text_review_required')
        self.assertEqual(operator_status('EnBW',''),'missing_data')
        self.assertEqual(output_powers({'socket:type2:output':'43000 W','socket:type2_combo:output':'150 kW','capacity':'4'}),[43,150])
        self.assertEqual(output_powers({'socket:type2_combo:output':'150'}),[])

    def test_full_pipeline_two_directions_and_checked_resume(self):
        import osmium
        import pyarrow as pa
        import pyarrow.parquet as pq
        from pyproj import Transformer
        import math
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);project=root/'project';data=project/'public/data';a5=project/'data_sources/a5'
            data.mkdir(parents=True);a5.mkdir(parents=True)
            source=b'fixture-source'
            startup=pa.table({'longitude':[11.001],'latitude':[49.999]}).replace_schema_metadata({b'source_sites_sha256':source})
            sp=data/'charging_sites_startup_zstd10.parquet';pq.write_table(startup,sp);sh=digest(sp)
            details=pa.table({'site_id':['site-test'],'operator':['Mainova AG'],'city':['Test'],'street':['Test'],'postal_code':['00000'],'house_number':['1'],'installed_power_kw':[600.],'available_power_kw':[[150.]]}).replace_schema_metadata({b'startup_sites_sha256':sh.encode(),b'source_sites_sha256':source})
            dp=data/'charging_site_details_zstd10.parquet';pq.write_table(details,dp)
            catalog=pa.table({'operator_name':['Mainova AG']}).replace_schema_metadata({b'startup_sites_sha256':sh.encode(),b'details_sha256':digest(dp).encode(),b'sites_sha256':source})
            pq.write_table(catalog,data/'charging_runtime_catalog_zstd10.parquet')
            network=fixture();network.append({'type':'way','id':101,'nodes':[4,3,2,1],'tags':{'highway':'motorway','ref':'A 5','oneway':'yes'}})
            coords={o['id']:(o['lon'],o['lat']) for o in network if o['type']=='node'}
            transform=Transformer.from_crs(4326,32632,always_xy=True).transform
            routes=[]
            for direction,nodes,way in [('north',[1,2,3,4],100),('south',[4,3,2,1],101)]:
                xy=[coords[n] for n in nodes];chain=[0.]
                for x,y in zip(xy,xy[1:]):chain.append(chain[-1]+math.dist(transform(*x),transform(*y)))
                routes.append({'direction':direction,'nodes':nodes,'coordinates':xy,'chain':chain,'way_ids':[way],'length_m':chain[-1]})
            (a5/'routes.json').write_text(json.dumps({'routes':routes}));(a5/'core.json').write_text(json.dumps({'elements':network}))
            pilot=pa.Table.from_pylist([{'kind':'site','direction':d,'geometry_json':json.dumps([11.001,49.999]),'site_row':0,'power_kw':600.,'fast_points':4,'status':'unconfirmed'} for d in ['north','south']]).replace_schema_metadata({b'startup_sites_sha256':sh.encode()})
            pq.write_table(pilot,data/'autobahn_a5_zstd10.parquet')
            pbf=root/'fixture.osm.pbf';writer=osmium.SimpleWriter(str(pbf))
            for o in network:
                if o['type']=='node':writer.add_node(osmium.osm.mutable.Node(id=o['id'],location=(o['lon'],o['lat']),tags={'amenity':'charging_station','operator':'Mainova AG','socket:type2_combo:output':'150 kW'} if o['id']==10 else {}))
            for o in network:
                if o['type']=='way':writer.add_way(osmium.osm.mutable.Way(id=o['id'],nodes=o['nodes'],tags=o['tags']))
            writer.close();output=root/'result';result=run(project,pbf,output)
            self.assertEqual(result['directional_cases'],2);self.assertEqual(result['unique_sites'],1)
            self.assertEqual(result['chunk_count'],2);self.assertEqual(result['confirmed_entrances'],0)
            self.assertFalse(result['intervals_recalculated'])
            self.assertTrue((output/'33-a5-full-entry-review-results.zip').is_file())
            network_mtime=(output/'network/a5/access-network.json').stat().st_mtime_ns
            checkpoint_mtime=(output/'chunks/north-00/completed.json').stat().st_mtime_ns
            rerun=run(project,pbf,output)
            self.assertEqual(rerun['directional_cases'],2)
            self.assertEqual((output/'network/a5/access-network.json').stat().st_mtime_ns,network_mtime)
            self.assertEqual((output/'chunks/north-00/completed.json').stat().st_mtime_ns,checkpoint_mtime)


if __name__=='__main__':unittest.main()
