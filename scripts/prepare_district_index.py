import argparse,collections,json,sqlite3
from pathlib import Path
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
from pyproj import Transformer
ap=argparse.ArgumentParser()
ap.add_argument('--districts-original',required=True)
ap.add_argument('--states-original',required=True)
ap.add_argument('--gpkg',required=True)
ap.add_argument('--repo',default=str(Path(__file__).resolve().parents[1]))
args=ap.parse_args();repo=Path(args.repo)
points=pq.read_table(repo/'public/data/charging_points_zstd10.parquet').to_pylist()
sites={s['site_id']:s for s in pq.read_table(repo/'public/data/charging_sites_zstd10.parquet').to_pylist()}
districts=pq.read_table(args.districts_original).to_pylist()
polys=shapely.from_wkb([d['geometry'] for d in districts]); tree=shapely.STRtree(polys)
eq={};eqcounts=collections.Counter()
for p in points:eq[p['equipment_id']]=p;eqcounts[p['equipment_id']]+=1
ids=list(eq);geom=shapely.points([[eq[i]['longitude'],eq[i]['latitude']] for i in ids])
# Explicit covers/intersects includes polygon boundaries; retain all candidates.
hits=tree.query(geom,predicate='intersects'); candidates=collections.defaultdict(list)
for p,d in zip(*hits):candidates[int(p)].append(int(d))
conn=sqlite3.connect(args.gpkg)
labels={code:{'display_name':name,'territory_type':kind} for code,name,kind in conn.execute('SELECT AGS,GEN,BEZ FROM vg250_krs WHERE GF=4')}
for code,kind in [('03241','Region'),('05334','Städteregion'),('10041','Regionalverband')]:labels[code]['territory_type']=kind
labels['07211']={'display_name':'Trier / Trier-Saarburg','territory_type':'Объединённая территория KBA'}
for d in districts: assert d['district_code'] in labels,d['district_code']
statecodes={s['state_name']:s['state_code'] for s in pq.read_table(args.states_original).to_pylist()}
counts=collections.Counter(); powers=collections.Counter(); equipment_counts=collections.Counter(); site_powers=collections.Counter(); review=[]; ambiguous=[]
for eid,p in eq.items():
 power=p["equipment_power_kw"]
 if power is None or not np.isfinite(power) or power<0: raise ValueError(f"Invalid equipment power: {eid}")
 site_powers[p["site_id"]]+=power
site_table=pq.read_table(repo/"public/data/charging_sites_zstd10.parquet")
if "installed_power_kw" in site_table.column_names: site_table=site_table.drop(["installed_power_kw"])
site_table=site_table.append_column("installed_power_kw",pa.array([site_powers[sid] for sid in site_table.column("site_id").to_pylist()],type=pa.float64()))
pq.write_table(site_table,repo/"public/data/charging_sites_zstd10.parquet",compression="zstd",compression_level=10)
transform=Transformer.from_crs(4326,3035,always_xy=True)
projpolys=shapely.transform(polys,transform.transform,interleaved=False)
for index,eid in enumerate(ids):
 p=eq[eid];site=sites[p['site_id']]; sc=statecodes[site['state_name']]
 options=[d for d in candidates[index] if districts[d]['state_code']==sc]
 if not options:
  # Do not silently snap a coordinate: record and leave unmatched.
  inds=[i for i,d in enumerate(districts) if d['state_code']==sc]
  dist=shapely.distance(projpolys[inds],shapely.transform(geom[index],transform.transform,interleaved=False))
  closest=inds[int(np.argmin(dist))]
  review.append({'equipment_id':eid,'site_id':p['site_id'],'longitude':p['longitude'],'latitude':p['latitude'],'nearest_district_code':districts[closest]['district_code'],'distance_m':float(min(dist)),'points':eqcounts[eid]})
  continue
 chosen=min(options,key=lambda i:districts[i]['district_code'])
 if len(options)>1:ambiguous.append({'equipment_id':eid,'codes':[districts[i]['district_code'] for i in options],'chosen':districts[chosen]['district_code']})
 key=(p['site_id'],districts[chosen]['district_code'])
 counts[key]+=eqcounts[eid]
 powers[key]+=p['equipment_power_kw']
 equipment_counts[key]+=1
rows=[{'site_id':sid,'district_code':code,'charging_point_count':n,'installed_power_kw':powers[(sid,code)],'equipment_count':equipment_counts[(sid,code)]} for (sid,code),n in sorted(counts.items())]
schema=pa.schema([('site_id',pa.string()),('district_code',pa.string()),('charging_point_count',pa.int32()),('installed_power_kw',pa.float64()),('equipment_count',pa.int32())],metadata={b'join':b'original KBA district polygons; equipment coordinates; boundary included; deterministic boundary tie by code; no snapping',b'compression_level':b'10'})
pq.write_table(pa.Table.from_pylist(rows,schema=schema),repo/'public/data/site_district_counts_zstd10.parquet',compression='zstd',compression_level=10)
(repo/'public/data/district_labels.json').write_text(json.dumps(labels,ensure_ascii=False),encoding='utf-8')
out=repo/'data-quality/2026-09-01/district_assignment.json'
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({'equipment':len(ids),'input_points':len(points),'assigned_points':sum(counts.values()),'unmatched_equipment':review,'boundary_ties':ambiguous,'site_district_rows':len(rows),'multi_district_sites':sum(v>1 for v in collections.Counter(sid for sid,code in counts).values())},ensure_ascii=False,indent=2),encoding='utf-8')
assert sum(counts.values())+sum(r['points'] for r in review)==len(points)
print({'assigned_points':sum(counts.values()),'unmatched_equipment':len(review),'unmatched_points':sum(r['points'] for r in review),'max_unmatched_distance':max([r['distance_m'] for r in review],default=0),'boundary_ties':len(ambiguous),'rows':len(rows)})
