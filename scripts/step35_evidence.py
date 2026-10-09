"""Conservative review of saved evidence; never changes map data or intervals."""
import csv, json, re, unicodedata, hashlib
from pathlib import Path
from collections import defaultdict, Counter

ALIASES = {'123energie': 'pfalzwerke'}
ALIAS_SOURCE = 'https://www.pfalzwerke.de/pfalzwerke-gruppe/presse/20201007-kooperation-dkv_n470016'

def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def save(path, value):
    path=Path(path); tmp=path.with_suffix(path.suffix+'.part')
    tmp.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False),encoding='utf-8');tmp.replace(path)
def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def canonical(value):
    text=unicodedata.normalize('NFC',str(value or '')).casefold()
    text=re.sub(r'\b(aktiengesellschaft|gmbh|ag|co|kg|mbh)\b',' ',text)
    text=re.sub(r'[^\w]+',' ',text).strip()
    text=' '.join(text.split())
    return ALIASES.get(text,text)
def operator_status(a,b):
    if not canonical(a) or not canonical(b):return 'missing'
    if canonical(a)==canonical(b):return 'compatible_name'
    def brand(value):
        value=canonical(value)
        for name in ['mainova','pfalzwerke','ionity','shell','enbw','cubos','e on']:
            if value==name or value.startswith(name+' '):return name
        return None
    x,y=brand(a),brand(b)
    return 'different_known_operator' if x and y and x!=y else 'different_text_review'
def side_name(value):
    tokens=set(re.findall(r'\w+',str(value or '').casefold()))
    # Site names describe the facility, not its driving direction.
    return next((v for v in ['nord','süd','sued','ost','west'] if v in tokens),None)
def opposite_name(a,b):
    x,y=side_name(a),side_name(b)
    return (x,y) in {('nord','süd'),('nord','sued'),('süd','nord'),('sued','nord'),('ost','west'),('west','ost')}
def truth(value):return value is True or str(value).lower()=='true'
def restrictions(checks):
    found=[]
    for c in checks:
        for node in c.get('nearby_tagged_nodes',[]):
            if node.get('on_traversed_geometry') and 'barrier' in node.get('tags',{}):found.append({'kind':'barrier','osm_id':node['osm_id'],'tags':node['tags']})
        for w in c.get('traversed_way_restrictions',[]):found.append({'kind':'road_restriction',**w})
        tags=c.get('terminal_way_tags',{})
        if any(tags.get(k) not in (None,'yes','designated') for k in ['access','vehicle','motor_vehicle','motorcar']) or 'opening_hours' in tags or any('conditional' in k for k in tags):found.append({'kind':'terminal_restriction','tags':tags})
    return list({json.dumps(v,sort_keys=True):v for v in found}.values())
def decision(e, siblings=()):
    tags=e.get('osm_tags',{}); reasons=[]
    if opposite_name(e.get('registry_address'),tags.get('name','')):reasons.append('opposite_facility_name')
    op=operator_status(e.get('registry_operator'),e.get('osm_operator'))
    if op=='different_known_operator':reasons.append('different_operator')
    power=set(e.get('registry_point_powers_kw',[])) & set(e.get('osm_connector_powers_kw',[]))
    shared=e.get('shared_with_site_rows',[])
    if reasons:return 'rejected_as_evidence',op,power,reasons
    if op=='compatible_name' and power and float(e.get('distance_m',999))<=30:
        return ('strong_candidate_shared_review' if shared else 'strong_candidate'),op,power,[]
    return 'manual_identity_review',op,power,(['shared_candidate'] if shared else [])
def csvfile(path,rows):
    fields=list(dict.fromkeys(k for r in rows for k in r)) or ['site_row']
    with Path(path).open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for r in rows:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()})
def enrich_paths(source, network):
    checks=read(source/'path-checks.json')
    objects={(o['type'],o['id']):o for o in read(network)['elements']}
    paths={}
    for f in read(source/'routes.geojson')['features']:
        p=f['properties']; key=(p['site_row'],p['direction'],p['target_kind'],p.get('osm_type',''),p.get('osm_id'),p['leg'])
        paths[key]=json.loads(p['arrival_ways_json'] if p['leg']=='arrival' else p['departure_ways_json'])
    for c in checks:
        key=(c['site_row'],c['direction'],c['target_kind'],c.get('osm_type',''),c.get('osm_id'),c['leg'])
        restricted=[]
        for wid in paths.get(key,[]):
            tags=objects['way',wid].get('tags',{})
            selected={k:v for k,v in tags.items() if k in ['access','vehicle','motor_vehicle','motorcar','opening_hours','service'] or 'conditional' in k}
            if any(k!='service' and v not in ['yes','designated'] for k,v in selected.items()):restricted.append({'osm_id':wid,'tags':selected})
        c['traversed_way_restrictions']=restricted
        c['all_traversed_way_tags_checked']=True
    return checks

def review(source, output, route, project, network=None):
    source=Path(source);output=Path(output);output.mkdir(parents=True,exist_ok=True)
    identities=read(source/'identity-details.json')
    checks=enrich_paths(source,network) if network else read(source/'path-checks.json')
    by_osm=defaultdict(list);by_target=defaultdict(list)
    for e in identities:by_osm[e['osm_type'],e['osm_id']].append(e)
    for c in checks:by_target[c['site_row'],c['direction'],c['target_kind'],c.get('osm_type',''),c.get('osm_id')].append(c)
    rows=[]
    for e in identities:
        status,op,powers,reasons=decision(e,by_osm[e['osm_type'],e['osm_id']])
        path=by_target[e['site_row'],e['direction'],'osm_charger_candidate',e['osm_type'],e['osm_id']]
        limits=restrictions(path)
        rows.append({**e,'route':route,'identity_assessment':status,'operator_assessment':op,'compatible_powers_kw':sorted(powers),'rejection_reasons':reasons,
                     'path_restrictions':limits,'mapped_route_usable_as_candidate':status!='rejected_as_evidence' and truth(e['mapped_target_route_found']),
                     'all_traversed_way_tags_checked':bool(path) and all(c.get('all_traversed_way_tags_checked',False) for c in path),
                     'association_verified':False,'entrance_verified':False})
    grouped=defaultdict(list)
    for r in rows:grouped[r['site_row'],r['direction']].append(r)
    with (source/'site-summary.csv').open(encoding='utf-8-sig',newline='') as f:summaries=list(csv.DictReader(f))
    import pyarrow.parquet as pq
    pilot=pq.read_table(Path(project)/f'public/data/autobahn_{route.lower()}_zstd10.parquet').to_pylist()
    anchors=defaultdict(list)
    for p in pilot:
        if p['kind']=='site' and p['power_kw']>=400 and p['fast_points']>0 and p['status']=='road_route_found_entrance_unverified':anchors[p['direction'],p.get('section')].append(p)
    endpoints=defaultdict(list)
    segments=[p for p in pilot if p['kind']=='segment' and p.get('gap_km') is not None and p.get('status')!='unknown']
    for direction in ['north','south']:
        for s in sorted([p for p in segments if p['direction']==direction],key=lambda p:p['gap_km'],reverse=True)[:10]:
            for bound in [s['chain_m'],s['end_m']]:
                for a in anchors[direction,s.get('section')]:
                    if abs(a['chain_m']-bound)<0.01:endpoints[a['site_row'],direction].append(round(s['gap_km'],3))
    queue=[]
    for s in summaries:
        sr=int(s['site_row']);direction=s['direction'];es=grouped[sr,direction];eligible=truth(s['eligible_power']);reg=by_target[sr,direction,'registry_coordinate','',None]
        candidates=[e for e in es if e['mapped_route_usable_as_candidate']]
        limits=restrictions(reg)
        gaps=endpoints[sr,direction]
        queue.append({**s,'route':route,'long_gap_endpoint_km':sorted(set(gaps),reverse=True),'review_priority':0 if eligible and gaps else 1 if eligible and (candidates or truth(s.get('road_route_found'))) else 2 if eligible else 3,
                      'retained_mapped_routes':len(candidates),'rejected_identity_candidates':sum(e['identity_assessment']=='rejected_as_evidence' for e in es),
                      'strong_identity_candidates':sum(e['identity_assessment'].startswith('strong_candidate') for e in es),
                      'registry_path_restrictions':limits,'candidate_path_restrictions':[{'osm_id':e['osm_id'],'restrictions':e['path_restrictions']} for e in candidates if e['path_restrictions']],
                      'review_needed':['identity','last_metres']+(['access_conditions'] if limits or any(e['path_restrictions'] for e in candidates) else []),
                      'association_verified':False,'entrance_verified':False})
    queue.sort(key=lambda s:(s['review_priority'],-max(s['long_gap_endpoint_km'],default=0),s['direction'],int(s['site_row'])))
    csvfile(output/'identity-assessment.csv',rows);save(output/'identity-assessment.json',rows)
    csvfile(output/'review-queue.csv',queue);csvfile(output/'power-priority.csv',[s for s in queue if truth(s['eligible_power'])]);save(output/'path-checks-enriched.json',checks)
    summary={'route':route,'unique_sites':len({s['site_row'] for s in queue}),'directional_cases':len(queue),'identity_candidates':len(rows),'identity_assessments':dict(Counter(e['identity_assessment'] for e in rows)),
             'retained_candidate_route_cases':sum(bool(s['retained_mapped_routes']) for s in queue),'eligible_directional_cases':sum(truth(s['eligible_power']) for s in queue),'long_gap_endpoint_cases':sum(bool(s['long_gap_endpoint_km']) for s in queue),
             'confirmed_entrances':0,'intervals_recalculated':False,'aliases':ALIASES,'alias_source':ALIAS_SOURCE,
             'input_audit_sha256':digest(source/'audit.json'),'policy':'Candidate review only. Missing OSM names/power/areas remain unknown; no route transfer between sites. No capacity summation of OSM sockets.'}
    save(output/'35-review-audit.json',summary);return summary
