"""Repair step 33 direction labels and endpoint rounding without scanning PBF."""
import argparse
import csv
import json
from pathlib import Path
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
EPSILON_M=0.001


def endpoint_in_chunk(chain,lower,upper,length):
    # Keep interior boundaries half-open; tolerate only terminal rounding.
    if upper >= length:
        return lower <= chain <= length+EPSILON_M
    return lower <= chain < upper


def correct_chunk_label(audit):
    active=[r['direction'] for r in audit['directions'] if r['sites']>0]
    if len(active)==1:audit['direction']=active[0]
    return audit


def run(project,previous,output):
    import pyarrow.parquet as pq
    from shapely.geometry import LineString,Point
    import a5_full_chunk_audit as chunk
    from a5_full_entry_review import digest,validate_registry
    from a5_full_evidence_report import report
    read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
    save=lambda p,d:p.write_text(json.dumps(d,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    project=project.resolve();previous=previous.resolve();output=output.resolve()
    if output==previous or output.is_relative_to(previous) or output.is_relative_to(project):
        raise ValueError('Use a new output directory outside step 33 and the project.')
    old=read(previous/'audit.json');binding=read(previous/'run-binding.json')
    if old['method']!='a5-full-entry-review-v1':raise ValueError('Expected a complete step 33 audit.')
    if validate_registry(project)!=old['registry_hashes']:raise ValueError('Registry changed since step 33.')
    pilot=project/'public/data/autobahn_a5_zstd10.parquet'
    if digest(pilot)!=old['pilot_sha256'] or digest(project/'data_sources/a5/routes.json')!=old['routes_sha256'] or digest(project/'data_sources/a5/core.json')!=old['core_sha256']:
        raise ValueError('Pilot route inputs changed since step 33.')
    network=previous/'network/a5/access-network.json'
    print('Checking saved network hash; no PBF read.',flush=True)
    if digest(network)!=old['network_sha256']:raise ValueError('Saved network differs from step 33.')
    pilot_rows=[r for r in pq.read_table(pilot).to_pylist() if r['kind']=='site']
    expected={(r['site_row'],r['direction']) for r in pilot_rows}
    original={name:read(previous/(name+'.geojson'))['features'] for name in ['routes','sites','entry_candidates','osm_areas','mapped_chargers','road_terminals']}
    have={(f['properties']['site_row'],f['properties']['direction']) for f in original['sites']}
    missing=expected-have
    if have-expected:raise ValueError('Unknown sites in step 33.')
    routes=read(project/'data_sources/a5/routes.json')['routes']
    rerun=set()
    for site_row,direction in missing:
        row=next(r for r in pilot_rows if (r['site_row'],r['direction'])==(site_row,direction))
        route=next(r for r in routes if r['direction']==direction)
        line=LineString([chunk.PROJECT.transform(*xy) for xy in route['coordinates']])
        point=Point(chunk.PROJECT.transform(*json.loads(row['geometry_json'])))
        projection=line.project(point)
        if abs(projection-route['length_m'])>EPSILON_M or line.distance(point)>3500+EPSILON_M:
            raise ValueError(f'Missing site {site_row}/{direction} is not an endpoint rounding case; manual diagnosis needed.')
        rerun.add((direction,len([a for a in old['directions'] if a['directions'][0 if direction=='north' else 1]['sites']>0])-1))
    output.mkdir(parents=True,exist_ok=True)
    chunk.in_chunk=endpoint_in_chunk
    replacements=[]
    revised_audits=[]
    for direction in ['north','south']:
        direction_chunks=[a for a in old['directions'] if a['directions'][0 if direction=='north' else 1]['sites']>0]
        for index,part in enumerate(direction_chunks):
            part=correct_chunk_label(part)
            if (direction,index) in rerun:
                lower,upper=part['chain_range_m']
                folder=output/'rechecked-chunks'/f'{direction}-{index:02d}'
                print(f'Rechecking only {direction} {lower/1000:.1f}–{upper/1000:.1f} km.',flush=True)
                chunk.audit(project,Path('PBF_NOT_READ'),folder,direction,lower,upper,network)
                part=correct_chunk_label(read(folder/'audit.json'))
                keys={(f['properties']['site_row'],direction) for f in read(folder/'sites.geojson')['features']}
                old_keys={(r['site_row'],direction) for r in pilot_rows if r['direction']==direction and r['site_row'] in {k[0] for k in keys}}
                replacements.append((folder,keys|old_keys))
            revised_audits.append(part)
    removed=set().union(*(keys for _,keys in replacements)) if replacements else set()
    for name,features in original.items():
        features=[f for f in features if (f['properties']['site_row'],f['properties']['direction']) not in removed]
        for folder,_ in replacements:features.extend(read(folder/(name+'.geojson'))['features'])
        save(output/(name+'.geojson'),{'type':'FeatureCollection','features':features})
        if name=='sites':
            pairs=[(f['properties']['site_row'],f['properties']['direction']) for f in features]
            if len(pairs)!=len(set(pairs)) or set(pairs)!=expected:raise ValueError('Repaired coverage does not equal the complete pilot site set.')
    with (previous/'site-review.csv').open(encoding='utf-8-sig',newline='') as f:
        probes=[r for r in csv.DictReader(f) if (int(r['site_row']),r['direction']) not in removed]
    for folder,_ in replacements:
        with (folder/'site-review.csv').open(encoding='utf-8-sig',newline='') as f:probes.extend(csv.DictReader(f))
    fields=list(dict.fromkeys(k for r in probes for k in r))
    with (output/'site-review.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(probes)
    totals=report(project,output,network)
    revised={**old,**totals,'method':'a5-full-entry-review-repair-v1','directions':revised_audits,
             'repair':{'previous_audit_sha256':digest(previous/'audit.json'),'missing_before':sorted(missing),
                       'chunks_rechecked':len(replacements),'endpoint_tolerance_m':EPSILON_M,'pbf_scanned':False}}
    save(output/'audit.json',revised)
    archive=output/'34-a5-full-entry-review-results.zip'
    names=['audit.json','site-review.csv','site-summary.csv','priority-review.csv','identity-review.csv','identity-details.json','path-checks.json','routes.geojson','sites.geojson','entry_candidates.geojson','osm_areas.geojson','mapped_chargers.geojson','road_terminals.geojson']
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for name in names:z.write(output/name,name)
    print(f'Done: {archive}. Coverage: {totals}. Original step 33 is unchanged.',flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--project',type=Path,default=ROOT)
    p.add_argument('--previous',type=Path,default=ROOT.parent/'data/33_step_a5_full_entry_review')
    p.add_argument('--output',type=Path,default=ROOT.parent/'data/34_step_a5_full_entry_review')
    a=p.parse_args()
    try:run(a.project,a.previous,a.output)
    except Exception as e:
        import traceback
        traceback.print_exc();print(f'Repair stopped: {e}',file=sys.stderr);return 1
    return 0


if __name__=='__main__':sys.exit(main())
