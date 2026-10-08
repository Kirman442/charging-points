"""Stream large audited road JSON into a reusable local spatial SQLite index."""
import argparse
import hashlib
import json
import sqlite3
import time
from pathlib import Path
import ijson
from pyproj import Transformer

PROJECT = Transformer.from_crs(4326, 32632, always_xy=True)

def log(message):
    print(time.strftime('%H:%M:%S'), message, flush=True)

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8*1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def chunks(items, size=20000):
    items = list(items)
    for i in range(0,len(items),size): yield items[i:i+size]

def index(path, destination):
    destination.parent.mkdir(parents=True,exist_ok=True)
    digest = sha(path)
    if destination.exists():
        db = sqlite3.connect(destination)
        try:
            ready = db.execute("SELECT value FROM meta WHERE key='sha256'").fetchone()
            if ready == (digest,):
                log(f'Reusing index {destination}')
                return
        finally: db.close()
        raise ValueError('Existing index is incomplete or belongs to another JSON; choose a new path')
    db = sqlite3.connect(destination)
    try:
        db.executescript('''PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-131072;
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE n(id INTEGER PRIMARY KEY,lon REAL,lat REAL,x REAL,y REAL,tags TEXT);
        CREATE TABLE w(id INTEGER PRIMARY KEY,body TEXT);
        CREATE VIRTUAL TABLE bbox USING rtree(id,minx,maxx,miny,maxy);
        CREATE TABLE r(id INTEGER PRIMARY KEY,body TEXT);
        CREATE TABLE rm(rel INTEGER,kind TEXT,ref INTEGER);
        CREATE INDEX rm_ref ON rm(kind,ref);
        ''')
        nodes=[]; ways=[]; counts={'node':0,'way':0,'relation':0}
        def flush_nodes():
            if not nodes: return
            xs,ys=PROJECT.transform([o['lon'] for o in nodes],[o['lat'] for o in nodes])
            db.executemany('INSERT INTO n VALUES(?,?,?,?,?,?)',((o['id'],o['lon'],o['lat'],float(x),float(y),json.dumps(o.get('tags',{}),separators=(',',':'))) for o,x,y in zip(nodes,xs,ys)))
            nodes.clear()
        def flush_ways():
            if not ways:return
            refs={n for w in ways for n in w['nodes']}; coords={}
            for batch in chunks(refs):
                coords.update((ident,(x,y)) for ident,x,y in db.execute('SELECT id,x,y FROM n WHERE id IN ('+','.join('?' for _ in batch)+')',batch))
            for w in ways:
                xy=[coords[n] for n in w['nodes']]
                if len(xy)<2:raise ValueError(f'Degenerate way {w["id"]}')
                xx,yy=zip(*xy)
                db.execute('INSERT INTO w VALUES(?,?)',(w['id'],json.dumps(w,separators=(',',':'))))
                db.execute('INSERT INTO bbox VALUES(?,?,?,?,?)',(w['id'],min(xx),max(xx),min(yy),max(yy)))
            ways.clear()
        with path.open('rb') as stream:
            for obj in ijson.items(stream,'elements.item',use_float=True):
                kind=obj['type'];counts[kind]+=1
                if kind=='node':
                    nodes.append(obj)
                    if len(nodes)>=10000:flush_nodes()
                elif kind=='relation':
                    flush_nodes()
                    db.execute('INSERT INTO r VALUES(?,?)',(obj['id'],json.dumps(obj,separators=(',',':'))))
                    db.executemany('INSERT INTO rm VALUES(?,?,?)',((obj['id'],m['type'],m['ref']) for m in obj['members']))
                else:
                    flush_nodes();ways.append(obj)
                    if len(ways)>=1000:flush_ways()
                if sum(counts.values())%500000==0:
                    log(f'{path.parent.name}: indexed {counts}')
                    db.commit()
        flush_nodes();flush_ways();db.commit()
        db.execute('INSERT INTO meta VALUES(?,?)',('sha256',digest))
        db.execute('INSERT INTO meta VALUES(?,?)',('counts',json.dumps(counts)))
        db.commit();log(f'Index ready: {destination}; {counts}')
    finally:db.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--network',type=Path,required=True);parser.add_argument('--index',type=Path,required=True)
    args=parser.parse_args();index(args.network,args.index)

class RoadStore:
    def __init__(self,path):
        self.db=sqlite3.connect(path)
    def ways(self,ids):
        result={}
        for batch in chunks(ids):
            result.update((ident,json.loads(body)) for ident,body in self.db.execute('SELECT id,body FROM w WHERE id IN ('+','.join('?' for _ in batch)+')',batch))
        return result
    def nodes(self,ids):
        result={}
        for batch in chunks(ids):
            for ident,lon,lat,tags in self.db.execute('SELECT id,lon,lat,tags FROM n WHERE id IN ('+','.join('?' for _ in batch)+')',batch):
                result[ident]={'type':'node','id':ident,'lon':lon,'lat':lat,'tags':json.loads(tags)}
        return result
    def tile(self,bounds):
        a,b,c,d=bounds
        ids=[ident for ident, in self.db.execute('SELECT id FROM bbox WHERE maxx>=? AND minx<=? AND maxy>=? AND miny<=?',(a,c,b,d))]
        ways=self.ways(ids)
        refs={n for w in ways.values() for n in w['nodes']}
        nodes=self.nodes(refs)
        relations={}
        for batch in chunks(ids):
            for ident,body in self.db.execute("SELECT DISTINCT r.id,r.body FROM r JOIN rm ON rm.rel=r.id WHERE rm.kind='way' AND rm.ref IN ("+','.join('?' for _ in batch)+')',batch):
                relations[ident]=json.loads(body)
        if len(nodes)!=len(refs):raise ValueError('Incomplete tile geometry')
        return [*nodes.values(),*ways.values(),*relations.values()]
