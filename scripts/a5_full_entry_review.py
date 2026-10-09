"""Step 33: full A5 evidence audit, one PBF extraction, sequential 50 km chunks."""
import argparse
import csv
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import time
import zipfile

ROOT=Path(__file__).resolve().parents[1]


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path,data):
    temporary=path.with_suffix(path.suffix+'.part')
    temporary.write_text(json.dumps(data,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    temporary.replace(path)


def log(message):print(time.strftime('%H:%M:%S'),message,flush=True)


def validate_registry(project):
    import pyarrow.parquet as pq
    data=project/'public/data'
    files={k:data/f'charging_{k}_zstd10.parquet' for k in ['sites_startup','site_details','runtime_catalog']}
    hashes={k:digest(p) for k,p in files.items()}
    sm=pq.read_schema(files['sites_startup']).metadata or {}
    dm=pq.read_schema(files['site_details']).metadata or {}
    cm=pq.read_schema(files['runtime_catalog']).metadata or {}
    if cm.get(b'startup_sites_sha256',b'').decode()!=hashes['sites_startup'] or cm.get(b'details_sha256',b'').decode()!=hashes['site_details'] or dm.get(b'startup_sites_sha256',b'').decode()!=hashes['sites_startup'] or dm.get(b'source_sites_sha256')!=cm.get(b'sites_sha256') or sm.get(b'source_sites_sha256')!=cm.get(b'sites_sha256'):
        raise ValueError('Registry file bindings differ. Use matching startup, details and catalog files.')
    if pq.ParquetFile(files['sites_startup']).metadata.num_rows!=pq.ParquetFile(files['site_details']).metadata.num_rows:
        raise ValueError('Registry row counts differ.')
    return hashes


def run(project,pbf,output,chunk_km=50):
    from shapely.geometry import MultiLineString
    from extract_a5_full_network import extract
    from a5_full_chunk_audit import audit
    import pyarrow.parquet as pq
    begin=time.monotonic();project=project.resolve();output=output.resolve();pbf=pbf.resolve()
    if output.is_relative_to(project):raise ValueError('Keep step 33 output outside the project directory.')
    if not 10<=chunk_km<=80:raise ValueError('Chunk length must be 10–80 km.')
    if not pbf.is_file():raise ValueError(f'PBF not found: {pbf}')
    hashes=validate_registry(project)
    route_path=project/'data_sources/a5/routes.json';core_path=project/'data_sources/a5/core.json'
    pilot=project/'public/data/autobahn_a5_zstd10.parquet'
    if pq.read_schema(pilot).metadata[b'startup_sites_sha256'].decode()!=hashes['sites_startup']:raise ValueError('A5 pilot / registry mismatch.')
    routes=read(route_path)['routes']
    if {r['direction'] for r in routes}!={'north','south'} or len(routes)!=2:raise ValueError('Expected both complete A5 directional routes.')
    for r in routes:
        if len(r['nodes'])!=len(r['chain']) or len(r['nodes'])!=len(r['coordinates']) or any(b<=a for a,b in zip(r['chain'],r['chain'][1:])) or abs(r['chain'][-1]-r['length_m'])>0.01:
            raise ValueError('Invalid directional route chains.')
    stat=pbf.stat()
    binding={'method':'a5-full-entry-review-v1','registry_hashes':hashes,'routes_sha256':digest(route_path),
             'core_sha256':digest(core_path),'pilot_sha256':digest(pilot),'pbf_bytes':stat.st_size,'pbf_mtime_ns':stat.st_mtime_ns,
             'seed_sha256':hashlib.sha256(MultiLineString([r['coordinates'] for r in routes]).wkb).hexdigest(),
             'chunk_km':chunk_km,'engine_hashes':{p.name:digest(p) for p in Path(__file__).parent.glob('*a5_full*.py')}}
    output.mkdir(parents=True,exist_ok=True)
    bp=output/'run-binding.json'
    if bp.exists() and read(bp)!=binding:raise ValueError('Existing output belongs to different inputs or code. Choose a new --output folder.')
    if not bp.exists():save(bp,binding)
    work=output/'work';work.mkdir(exist_ok=True);os.environ['TMP']=os.environ['TEMP']=str(work)
    network=output/'network/a5/access-network.json'
    if not network.exists():
        if shutil.disk_usage(output).free<25*1024**3:raise ValueError('At least 25 GB free on the work drive is required.')
        log('Extracting full A5 corridor from local PBF; this is the long first stage.')
        extract(pbf,{'A5':MultiLineString([r['coordinates'] for r in routes])},output/'network',buffer_km=8,work_dir=work)
    else:log('Reusing completed full A5 network. PBF extraction is skipped.')
    source=read(network.parent/'pbf-extraction-audit.json')
    if source.get('bytes')!=stat.st_size or source.get('mtime_ns')!=stat.st_mtime_ns:raise ValueError('PBF metadata differs from the saved network.')
    network_hash=digest(network)
    chunks=[]
    for direction in ['north','south']:
        route=next(r for r in routes if r['direction']==direction)
        count=math.ceil(route['length_m']/(chunk_km*1000))
        for index in range(count):
            lower=index*chunk_km*1000;upper=min((index+1)*chunk_km*1000,route['length_m'])
            folder=output/'chunks'/f'{direction}-{index:02d}'
            completed=folder/'completed.json'
            expected={'network_sha256':network_hash,'binding_sha256':digest(bp),'direction':direction,'lower':lower,'upper':upper}
            good=False
            if completed.exists():
                checkpoint=read(completed)
                good=checkpoint.get('binding')==expected and all((folder/name).exists() and digest(folder/name)==value for name,value in checkpoint.get('files',{}).items()) and bool(checkpoint.get('files'))
            if good:log(f'Reusing checked chunk {direction} {index+1}/{count}')
            else:
                log(f'Checking {direction} chunk {index+1}/{count}: {lower/1000:.1f}–{upper/1000:.1f} km')
                audit(project,pbf,folder,direction,lower,upper,network)
                names=['audit.json','site-review.csv','routes.geojson','sites.geojson','entry_candidates.geojson','osm_areas.geojson','mapped_chargers.geojson','road_terminals.geojson']
                save(completed,{'binding':expected,'files':{name:digest(folder/name) for name in names}})
            chunks.append(folder);gc.collect()
    for name in ['routes','sites','entry_candidates','osm_areas','mapped_chargers','road_terminals']:
        features=[]
        for folder in chunks:features.extend(read(folder/(name+'.geojson'))['features'])
        if name=='sites':
            pairs=[(f['properties']['site_row'],f['properties']['direction']) for f in features]
            if len(pairs)!=len(set(pairs)):raise ValueError('Duplicate sites across chunk boundaries.')
        save(output/(name+'.geojson'),{'type':'FeatureCollection','features':features})
    reviews=[]
    for folder in chunks:
        with (folder/'site-review.csv').open(encoding='utf-8-sig',newline='') as f:reviews.extend(csv.DictReader(f))
    fields=list(dict.fromkeys(k for row in reviews for k in row))
    with (output/'site-review.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(reviews)
    log('Comparing operators, equipment, parking areas and actual path nodes...')
    from a5_full_evidence_report import report
    totals=report(project,output,network)
    summary={**binding,**totals,'source':source,'network_sha256':network_hash,'chunk_count':len(chunks),
             'routing_policy':{'approach_m':3000,'return_m':3000,'snap_m':60},
             'directions':[read(folder/'audit.json') for folder in chunks],
             'elapsed_seconds':round(time.monotonic()-begin,1),'association_verified':False,
             'limitations':'Evidence audit only. Nearby road/charger/entrance is not a confirmed site connection. No automatic interval recalculation.'}
    save(output/'audit.json',summary)
    names=['audit.json','site-review.csv','site-summary.csv','priority-review.csv','identity-review.csv','identity-details.json','path-checks.json',
           'routes.geojson','sites.geojson','entry_candidates.geojson','osm_areas.geojson','mapped_chargers.geojson','road_terminals.geojson']
    archive=output/'33-a5-full-entry-review-results.zip'
    with zipfile.ZipFile(archive.with_suffix('.zip.part'),'w',zipfile.ZIP_DEFLATED) as z:
        for name in names:z.write(output/name,name)
    archive.with_suffix('.zip.part').replace(archive)
    log(f'Done: {totals}. Send {archive}')
    return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',type=Path,default=ROOT)
    parser.add_argument('--pbf',type=Path,default=ROOT.parent/'data/germany-latest.osm.pbf')
    parser.add_argument('--output',type=Path,default=ROOT.parent/'data/33_step_a5_full_entry_review')
    parser.add_argument('--chunk-km',type=float,default=50)
    args=parser.parse_args()
    try:run(args.project,args.pbf,args.output,args.chunk_km)
    except Exception as e:
        import traceback
        traceback.print_exc();print(f'Processing stopped: {e}. Completed network and chunks are kept.',file=sys.stderr);return 1
    return 0


if __name__=='__main__':sys.exit(main())
