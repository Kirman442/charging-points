import unittest,tempfile,sys,json,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from step35_evidence import decision,opposite_name,canonical,restrictions,read,save,digest
from step35_desktop_review import motorway

class EvidenceTests(unittest.TestCase):
 def test_operator_alias_does_not_merge_other_operators(self):
  self.assertEqual(canonical('Pfalzwerke AG'),canonical('123energie'))
  self.assertNotEqual(canonical('CUBOS Service GmbH'),canonical('Mainova AG'))
 def test_opposite_facility_not_driving_direction(self):
  self.assertTrue(opposite_name('Grünberg Reinhardshain Süd','Reinhardshain Nord'))
  self.assertFalse(opposite_name('Grünberg Reinhardshain Süd','IONITY'))
 def test_cubos_cannot_claim_mainova_route(self):
  s=decision({'registry_operator':'CUBOS Service GmbH','osm_operator':'Mainova AG','registry_point_powers_kw':[11],'osm_connector_powers_kw':[150],'distance_m':90})
  self.assertEqual(s[0],'rejected_as_evidence')
 def test_brand_power_shared_candidate_is_not_verified(self):
  s=decision({'registry_operator':'Pfalzwerke AG','osm_operator':'123energie','registry_point_powers_kw':[50,320],'osm_connector_powers_kw':[320],'distance_m':17.6,'shared_with_site_rows':[3]})
  self.assertEqual(s[0],'strong_candidate_shared_review')
 def test_unknown_operator_text_is_not_automatic_rejection(self):
  self.assertEqual(decision({'registry_operator':'Example Energy AG','osm_operator':'Example','registry_point_powers_kw':[150],'osm_connector_powers_kw':[150],'distance_m':4})[0],'manual_identity_review')
 def test_missing_data_remains_unknown(self):
  self.assertEqual(decision({'registry_operator':'IONITY GmbH','osm_operator':'IONITY','distance_m':12})[0],'manual_identity_review')
 def test_barrier_only_if_on_route_and_road_conditions_retained(self):
  r=restrictions([{'nearby_tagged_nodes':[{'osm_id':1,'tags':{'barrier':'gate'},'on_traversed_geometry':False},{'osm_id':2,'tags':{'barrier':'lift_gate','access':'permissive'},'on_traversed_geometry':True}], 'traversed_way_restrictions':[{'osm_id':3,'tags':{'access':'customers'}}]}])
  self.assertEqual({v['osm_id'] for v in r},{2,3})

class PipelineTests(unittest.TestCase):
 def test_two_motorways_disconnected_sections_and_resume(self):
  import pyarrow as pa,pyarrow.parquet as pq,osmium
  from pyproj import Transformer
  from shapely.geometry import MultiLineString
  from extract_a5_full_network import extract
  transform=Transformer.from_crs(4326,32632,always_xy=True).transform
  # Windows may retain pyosmium's mmap after the synthetic scan. The extractor
  # already reports deferred cleanup; do not turn that into a routing failure.
  with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
   root=Path(td);project=root/'project';data=project/'public/data';data.mkdir(parents=True);out=root/'output';out.mkdir()
   network=[];records=[]
   for j,lat in enumerate([50,51]):
    coords={1:(11,lat+.001),2:(11,lat),3:(11.002,lat),4:(11.002,lat+.001),10:(11.001,lat-.001)};off=j*100
    network += [{'type':'node','id':off+n,'lon':p[0],'lat':p[1],'tags':{'amenity':'charging_station','operator':'Mainova AG','socket:type2_combo:output':'150 kW'} if n==10 else {}} for n,p in coords.items()]
    network += [{'type':'way','id':off+1000,'nodes':[off+n for n in [1,2,3,4]],'tags':{'highway':'motorway','oneway':'yes'}},{'type':'way','id':off+1001,'nodes':[off+n for n in [4,3,2,1]],'tags':{'highway':'motorway','oneway':'yes'}},{'type':'way','id':off+2000,'nodes':[off+2,off+10],'tags':{'highway':'service','oneway':'yes','access':'customers'}},{'type':'way','id':off+2001,'nodes':[off+10,off+3],'tags':{'highway':'service','oneway':'yes'}}]
    for direction,ns,w in [('north',[1,2,3,4],1000),('south',[4,3,2,1],1001)]:
     xy=[coords[n] for n in ns];chain=[0.]
     for a,b in zip(xy,xy[1:]):chain.append(chain[-1]+math.dist(transform(*a),transform(*b)))
     records.append({'direction':direction,'section':['southern','northern'][j],'nodes':[off+n for n in ns],'coordinates':xy,'chain':chain,'way_ids':[off+w],'length_m':chain[-1]})
   source=b'test-source';startup=data/'charging_sites_startup_zstd10.parquet';pq.write_table(pa.table({'longitude':[11.001,11.001],'latitude':[49.999,50.999]}).replace_schema_metadata({b'source_sites_sha256':source}),startup);sh=digest(startup)
   pq.write_table(pa.Table.from_pylist([{'site_id':f'site-{i}','operator':'Mainova AG','postal_code':'00000','city':'Test','street':'Test','house_number':'1','available_power_kw':[150.],'installed_power_kw':600.} for i in [0,1]]).replace_schema_metadata({b'startup_sites_sha256':sh.encode(),b'source_sites_sha256':source}),data/'charging_site_details_zstd10.parquet')
   definitions={'A1':{'routes':records,'elements':network},'A9':{'routes':[{k:v for k,v in r.items() if k!='section'} for r in records[:2]],'elements':network}}
   for route,d in definitions.items():
    rows=[]
    for r in d['routes']:
     i=0 if r.get('section')!='northern' else 1
     rows.append({'kind':'site','direction':r['direction'],'section':r.get('section'),'site_row':i,'geometry_json':json.dumps([11.001,49.999+i]),'power_kw':600.,'fast_points':4,'status':'unconfirmed'})
    pq.write_table(pa.Table.from_pylist(rows).replace_schema_metadata({b'startup_sites_sha256':sh.encode()}),data/f'autobahn_{route.lower()}_zstd10.parquet')
   pbf=root/'test.osm.pbf';writer=osmium.SimpleWriter(str(pbf))
   for o in network:
    if o['type']=='node':writer.add_node(osmium.osm.mutable.Node(id=o['id'],location=(o['lon'],o['lat']),tags=o['tags']))
   for o in network:
    if o['type']=='way':writer.add_way(osmium.osm.mutable.Way(id=o['id'],nodes=o['nodes'],tags=o['tags']))
   writer.close()
   extract(pbf,{r:MultiLineString([p['coordinates'] for p in d['routes']]) for r,d in definitions.items()},root/'network',buffer_km=8,work_dir=root/'work')
   for route,d in definitions.items():
    net=root/'network'/route.lower()/'access-network.json';res=motorway(project,pbf,out,route,d,net,{'sites_startup':sh});self.assertEqual(res['directional_cases'],4 if route=='A1' else 2);self.assertFalse(res['intervals_recalculated']);self.assertEqual(res['confirmed_entrances'],0)
    checkpoint=next((out/route.lower()/'chunks').glob('*/completed.json'));mtime=checkpoint.stat().st_mtime_ns
    rerun=motorway(project,pbf,out,route,d,net,{'sites_startup':sh});self.assertEqual(checkpoint.stat().st_mtime_ns,mtime)
    paths=read(out/route.lower()/'path-checks-enriched.json');self.assertTrue(any(c['traversed_way_restrictions'] for c in paths));self.assertTrue(all(c['all_traversed_way_tags_checked'] for c in paths))
if __name__=='__main__':unittest.main()
