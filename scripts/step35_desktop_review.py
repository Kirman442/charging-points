"""Desktop A5 saved-evidence review followed by sequential A1/A9 corridor audits."""
import argparse,sys,os,time,math,csv,zipfile,shutil,gc,traceback
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'step35_engine'))
from step35_evidence import read,save,digest,review
from step35_checkpoints import code_hashes,ensure_extraction

def log(s):print(time.strftime('%H:%M:%S'),s,flush=True)
def validate(project):
    import pyarrow.parquet as pq
    files={k:project/f'public/data/charging_{k}_zstd10.parquet' for k in ['sites_startup','site_details','runtime_catalog']}
    hashes={k:digest(p) for k,p in files.items()}
    sm=pq.read_schema(files['sites_startup']).metadata or {};dm=pq.read_schema(files['site_details']).metadata or {};cm=pq.read_schema(files['runtime_catalog']).metadata or {}
    if cm.get(b'startup_sites_sha256',b'').decode()!=hashes['sites_startup'] or cm.get(b'details_sha256',b'').decode()!=hashes['site_details'] or dm.get(b'startup_sites_sha256',b'').decode()!=hashes['sites_startup'] or dm.get(b'source_sites_sha256')!=cm.get(b'sites_sha256') or sm.get(b'source_sites_sha256')!=cm.get(b'sites_sha256'):raise ValueError('Registry file bindings differ')
    return hashes

def definition(project,route):
    path=Path(__file__).parent/'step35_engine/routes'/f'{route.lower()}.json';d=read(path)
    for name,h in d['source_hashes'].items():
        p=project/'data_sources'/route.lower()/name
        if not p.is_file() or digest(p)!=h:raise ValueError(f'{route}: source differs or missing: {p}. Send this message; no project files changed.')
    return d

def archive(output,name):
    target=output/name
    with zipfile.ZipFile(target.with_suffix('.zip.part'),'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(output.iterdir()):
            if p.is_file() and p.suffix in ['.json','.csv','.geojson']:z.write(p,p.name)
    target.with_suffix('.zip.part').replace(target);return target

def a5_review(project,data,output,hashes):
    source=data/'34_step_a5_full_entry_review';old=read(source/'audit.json')
    if old['registry_hashes']!=hashes:raise ValueError('A5 step34 registry differs')
    if digest(project/'public/data/autobahn_a5_zstd10.parquet')!=old['pilot_sha256']:raise ValueError('A5 pilot differs from step34')
    network=data/'33_step_a5_full_entry_review/network/a5/access-network.json'
    if digest(network)!=old['network_sha256']:raise ValueError('Saved A5 network differs')
    log('A5: reviewing saved report and path tags. No PBF scan or route recomputation.')
    result=review(source,output,'A5',project,network)
    archive(output,'35-a5-review-results.zip');log(f'A5 done: {result}');return result

def motorway(project,pbf,root,route,definition,network,hashes,chunk_km=50):
    import pyarrow.parquet as pq
    from shapely.geometry import LineString,MultiLineString,Point
    import a5_full_chunk_audit as chunk
    from a5_full_evidence_report import report
    output=root/route.lower();output.mkdir(exist_ok=True)
    pilot_path=project/f'public/data/autobahn_{route.lower()}_zstd10.parquet';table=pq.read_table(pilot_path)
    if table.schema.metadata[b'startup_sites_sha256'].decode()!=hashes['sites_startup']:raise ValueError(f'{route} pilot registry differs')
    rows=[r for r in table.to_pylist() if r['kind']=='site']
    core={(o['type'],o['id']):o for o in definition['elements']}
    nh=digest(network)
    binding={'method':'step35-full-evidence-v1','route':route,'registry_hashes':hashes,'pilot_sha256':digest(pilot_path),'network_sha256':nh,'definition_sha256':digest(Path(__file__).parent/'step35_engine/routes'/f'{route.lower()}.json'),'chunk_km':chunk_km,
             'engine_hashes':{p.name:digest(p) for p in (Path(__file__).parent/'step35_engine').glob('*.py')},
             'code_hashes':code_hashes()}
    bp=output/'run-binding.json'
    if bp.exists() and read(bp)!=binding:raise ValueError(f'{route}: output input/code binding differs; choose a new output folder')
    save(bp,binding)
    folders=[]
    for active in sorted(definition['routes'],key=lambda r:(r['direction'],r.get('section',''))):
        direction=active['direction'];section=active.get('section');line=LineString([chunk.PROJECT.transform(*p) for p in active['coordinates']])
        def inputs(unused_project,wanted_direction,lower,upper):
            if wanted_direction!=direction:raise ValueError('wrong direction')
            chain=active['chain'];first=max(0,next((i for i,x in enumerate(chain) if x>=lower),len(chain)-1)-1);last=next((i for i,x in enumerate(chain) if x>=upper),len(chain)-1)
            seed=MultiLineString([active['coordinates'][first:last+1]])
            candidates=[]
            for row in rows:
                if row['direction']!=direction or row.get('section')!=section:continue
                lon,lat=chunk.json.loads(row['geometry_json']);p=Point(chunk.PROJECT.transform(lon,lat));pos=line.project(p)
                if lower<=pos and (pos<upper or upper>=active['length_m'] and pos<=active['length_m']+0.001) and line.distance(p)<=3500+0.001:
                    candidates.append({'site_row':row['site_row'],'direction':direction,'section':section,'route':route,'longitude':lon,'latitude':lat,'power_kw':row['power_kw'],'fast_points':row['fast_points'],'previous_status':row['status']})
            return [active],core,candidates,seed
        chunk.section_inputs=inputs
        count=math.ceil(active['length_m']/(chunk_km*1000))
        for i in range(count):
            lower=i*chunk_km*1000;upper=min((i+1)*chunk_km*1000,active['length_m']);folder=output/'chunks'/f'{section or "full"}-{direction}-{i:02d}';checkpoint=folder/'completed.json'
            expected={'binding_sha256':digest(bp),'lower':lower,'upper':upper,'section':section,'direction':direction}
            valid=False
            if checkpoint.exists():
                old=read(checkpoint);valid=old.get('binding')==expected and bool(old.get('files')) and all((folder/n).is_file() and digest(folder/n)==h for n,h in old['files'].items())
            if valid:log(f'{route}: reusing {folder.name}')
            else:
                log(f'{route}: {section or "full"} {direction} chunk {i+1}/{count}')
                chunk.audit(project,pbf,folder,direction,lower,upper,network)
                names=['audit.json','site-review.csv',*[n+'.geojson' for n in ['routes','sites','entry_candidates','osm_areas','mapped_chargers','road_terminals']]]
                save(checkpoint,{'binding':expected,'files':{n:digest(folder/n) for n in names}})
            folders.append(folder);gc.collect()
    for name in ['routes','sites','entry_candidates','osm_areas','mapped_chargers','road_terminals']:
        features=[f for folder in folders for f in read(folder/(name+'.geojson'))['features']]
        save(output/(name+'.geojson'),{'type':'FeatureCollection','features':features})
    actual=[(f['properties']['site_row'],f['properties']['direction']) for f in read(output/'sites.geojson')['features']]
    expected={(r['site_row'],r['direction']) for r in rows}
    if len(actual)!=len(set(actual)) or set(actual)!=expected:raise ValueError(f'{route}: missing/duplicate directional cases: missing {len(expected-set(actual))}, extra {len(set(actual)-expected)}')
    probes=[]
    for folder in folders:
        with (folder/'site-review.csv').open(encoding='utf-8-sig',newline='') as f:probes.extend(csv.DictReader(f))
    from step35_evidence import csvfile
    csvfile(output/'site-review.csv',probes)
    totals=report(project,output,network)
    save(output/'audit.json',{**binding,**totals,'route':route,'source':read(network.parent/'pbf-extraction-audit.json'),'routing_policy':{'approach_m':3000,'return_m':3000,'snap_m':60},'chunk_count':len(folders)})
    result=review(output,output,route,project,network)
    target=archive(output,f'35-{route.lower()}-review-results.zip');log(f'{route} done. Send {target}');return result

def run(project,data,output,mode='all'):
    project=project.resolve();data=data.resolve();output=output.resolve();begin=time.monotonic()
    if output.is_relative_to(project) or output==data:raise ValueError('Use a separate output folder outside project')
    if (output/'35-run-summary.json').exists():raise ValueError('Completed run is preserved. Use a new --output for another run; do not overwrite historical results.')
    for bp in output.glob('*/run-binding.json'):
        if read(bp).get('code_hashes')!=code_hashes():raise ValueError('Saved route checkpoints belong to older/different code. Keep them unchanged and use a new --output.')
    output.mkdir(parents=True,exist_ok=True);work=output/'work';work.mkdir(exist_ok=True);os.environ['TMP']=os.environ['TEMP']=str(work)
    hashes=validate(project);pbf=data/'germany-latest.osm.pbf';defs={}
    if mode in ['all','night']:
        for route in ['A1','A9']:
            defs[route]=definition(project,route)
            import pyarrow.parquet as pq
            pilot=project/f'public/data/autobahn_{route.lower()}_zstd10.parquet'
            metadata=pq.read_schema(pilot).metadata or {}
            if metadata.get(b'startup_sites_sha256',b'').decode()!=hashes['sites_startup']:raise ValueError(f'{route}: pilot and registry differ (preflight)')
            sections={(r.get('section'),r['direction']) for r in defs[route]['routes']}
            cases=[r for r in pq.read_table(pilot).to_pylist() if r['kind']=='site']
            if any((r.get('section'),r['direction']) not in sections for r in cases):raise ValueError(f'{route}: unexpected route section')
            pairs=[(r['site_row'],r['direction']) for r in cases]
            if len(pairs)!=len(set(pairs)):raise ValueError(f'{route}: duplicate registry cases across sections')
        if not pbf.is_file():raise ValueError(f'PBF missing: {pbf}')
    results={};errors={}
    if mode in ['all','a5']:
        try:results['A5']=a5_review(project,data,output/'a5',hashes)
        except Exception as e:errors['A5']=str(e);traceback.print_exc();log('A5 failed; A1/A9 can still run')
    if defs:
        from extract_a5_full_network import extract
        from shapely.geometry import MultiLineString
        stat=pbf.stat();nb={'pbf_bytes':stat.st_size,'pbf_mtime_ns':stat.st_mtime_ns,'definitions':{r:digest(Path(__file__).parent/'step35_engine/routes'/f'{r.lower()}.json') for r in defs},'buffer_km':8,
                         'extractor_hashes':{n:digest(Path(__file__).parent/'step35_engine'/n) for n in ['extract_a5_full_network.py','a5_full_pbf_completion.py']}}
        def extract_to(pending):
            if shutil.disk_usage(output).free<25*1024**3:raise ValueError('Need at least 25 GB free on work drive')
            log('A1 + A9: shared PBF extraction. First stage has no resumable mid-pass checkpoint.')
            extract(pbf,{r:MultiLineString([p['coordinates'] for p in d['routes']]) for r,d in defs.items()},pending,buffer_km=8,work_dir=work)
        netdir=ensure_extraction(output,nb,list(defs),extract_to,log)
        for route in ['A1','A9']:
            try:
                network=netdir/route.lower()/'access-network.json'
                results[route]=motorway(project,pbf,output,route,defs[route],network,hashes)
            except Exception as e:errors[route]=str(e);traceback.print_exc();log(f'{route} failed; continuing to next motorway')
    save(output/'35-run-summary.json',{'results':results,'errors':errors,'elapsed_seconds':round(time.monotonic()-begin,1),'intervals_recalculated':False})
    target=output/'35-all-review-results.zip'
    with zipfile.ZipFile(target.with_suffix('.zip.part'),'w',zipfile.ZIP_DEFLATED) as z:
        z.write(output/'35-run-summary.json','35-run-summary.json')
        if (output/'35-desktop-review.log').is_file():z.write(output/'35-desktop-review.log','35-desktop-review.log')
        for route in results:
            folder=output/route.lower()
            for p in folder.iterdir():
                if p.is_file() and p.suffix in ['.json','.csv']:z.write(p,f'{route.lower()}/{p.name}')
    target.with_suffix('.zip.part').replace(target)
    log(f'{"DONE" if not errors else "FINISHED WITH ERRORS"}. Send {target}')
    return 1 if errors else 0

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--project',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--data',type=Path,default=Path(r'M:\projekte\Ladesaeulenregister\data'));p.add_argument('--output',type=Path);p.add_argument('--mode',choices=['all','a5','night'],default='all');a=p.parse_args()
    try:return run(a.project,a.data,a.output or a.data/'35_step_motorway_review',a.mode)
    except Exception:traceback.print_exc();log('STOPPED: keep saved outputs and send the last log lines.');return 1
if __name__=='__main__':sys.exit(main())
