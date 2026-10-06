"""Download the A9 relation hierarchy and optional access network into a local cache.
The committed cache reproduces the initial pilot. Existing JSON is reused unless
--refresh is supplied. Overpass is contacted once; HTTP errors are not retried.
"""
import argparse
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
API = 'https://www.openstreetmap.org/api/0.6'
ACCESS_QUERY = '''[out:json][timeout:180];
relation(20738); >>;
way._["highway"="motorway"]->.a9;
way(around.a9:3500)["highway"]["highway"!~"footway|path|cycleway|steps|pedestrian|bridleway|track|construction|proposed"]->.roads;
(.roads;rel(bw.roads)["type"="restriction"];);
(._;>>;);out body;'''


def download(path, url, refresh, session, data=None):
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    response = session.post(url, data=data, timeout=230) if data else session.get(url, timeout=60)
    response.raise_for_status()
    result = response.json()
    if 'elements' not in result or result.get('remark'):
        raise ValueError(f'Incomplete OSM response from {url}: {result.get("remark")}')
    temporary = path.with_suffix('.part')
    temporary.write_bytes(response.content)
    temporary.replace(path)
    return result


def fetch(source, refresh=False, access=False, overpass='https://overpass-api.de/api/interpreter'):
    source.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers['User-Agent'] = 'charging-points-a9-pilot/1.0 (offline GIS research)'
    todo, seen = [20738], set()
    while todo:
        relation_id = todo.pop()
        if relation_id in seen:
            continue
        seen.add(relation_id)
        payload = download(source / f'relation-{relation_id}.json', f'{API}/relation/{relation_id}/full.json', refresh, session)
        relation = next(e for e in payload['elements'] if e['type']=='relation' and e['id']==relation_id)
        todo.extend(m['ref'] for m in relation['members'] if m['type']=='relation')
        print(f'Relation {relation_id}: {len(relation["members"])} members', flush=True)
    # Explicit missing-membership repairs identified and audited for this pilot.
    for way_id in [725303216, 725303217]:
        download(source / f'repair-way-{way_id}.json', f'{API}/way/{way_id}/full.json', refresh, session)
    if access:
        download(source / 'access-network.json', overpass, refresh, session, {'data': ACCESS_QUERY})
        print('Access network downloaded; site entrances and turn restrictions still require review.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'data_sources/a9')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--access-network', action='store_true')
    parser.add_argument('--overpass', default='https://overpass-api.de/api/interpreter')
    args = parser.parse_args()
    fetch(args.source, args.refresh, args.access_network, args.overpass)
