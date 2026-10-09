"""Complete missing references directly from the PBF, without a location cache."""
import json
import osmium


def quarantine(store, routes, absent, log):
    for route in routes:
        rows = list(store.db.execute("SELECT body FROM objects WHERE route=? AND kind='relation'", (route,)))
        for body, in rows:
            obj = json.loads(body)
            missing = [m for m in obj['members'] if (m['type'], m['ref']) in absent]
            if not missing:
                continue
            previous = obj.get('incomplete_members', [])
            indexed = {(m['type'], m['ref'], m['role']): m for m in previous + missing}
            obj['incomplete_members'] = list(indexed.values())
            obj['routing_review_required'] = True
            obj['review_reason'] = 'restriction_member_absent_from_source_pbf'
            # Preserve original OSM tags/members. Consumers must block all known
            # member ways; do not pretend that a missing turn restriction is absent.
            obj['blocked_member_way_ids'] = sorted({m['ref'] for m in obj['members'] if m['type']=='way'})
            store.put(route, obj)
            log(f'{route}: restriction {obj["id"]} quarantined; missing {missing}')


def incomplete_restrictions(store, route):
    return [obj for body, in store.db.execute(
        "SELECT body FROM objects WHERE route=? AND kind='relation'", (route,))
        if (obj := json.loads(body)).get('routing_review_required')]


def write_review(store, route, destination):
    items = incomplete_restrictions(store, route)
    if not items:
        return None
    path = destination / 'incomplete-restriction-review.json'
    path.write_text(json.dumps({'route': route, 'count': len(items),
        'policy': 'block member ways until the incomplete restriction is reviewed',
        'restrictions': items}, ensure_ascii=False, indent=2), encoding='utf-8')
    return path


def complete(store, pbf, routes, log):
    rounds = 0
    while True:
        missing = {r: store.closure(r) for r in routes}
        way_ids = set().union(*(m['way'] for m in missing.values()))
        node_routes = {}
        for route, wanted in missing.items():
            for ident in wanted['node']:
                node_routes.setdefault(ident, set()).add(route)
        if not way_ids and not node_routes:
            store.db.commit()
            return rounds
        rounds += 1
        if rounds > 50:
            raise ValueError('Restriction closure did not converge')
        log(f'Completing restriction members: {len(way_ids)} ways, {len(node_routes)} nodes; direct PBF read')
        ways = {}
        if way_ids:
            for way in osmium.FileProcessor(str(pbf), osmium.osm.WAY).with_filter(osmium.filter.IdFilter(way_ids)):
                record = {'type': 'way', 'id': way.id, 'version': way.version,
                          'nodes': [n.ref for n in way.nodes], 'tags': dict(way.tags)}
                if len(record['nodes']) < 2:
                    raise ValueError(f'Degenerate restriction way {way.id}')
                ways[way.id] = record
                for route, wanted in missing.items():
                    if way.id in wanted['way']:
                        for ident in record['nodes']:
                            node_routes.setdefault(ident, set()).add(route)
            absent = way_ids - set(ways)
            if absent:
                quarantine(store, routes, {('way', ident) for ident in absent}, log)
        if node_routes:
            found = set()
            for node in osmium.FileProcessor(str(pbf), osmium.osm.NODE).with_filter(osmium.filter.IdFilter(node_routes)):
                if not node.location.valid():
                    raise ValueError(f'Invalid node coordinate: {node.id}')
                found.add(node.id)
                obj = {'type': 'node', 'id': node.id, 'lon': node.lon, 'lat': node.lat}
                for route in node_routes[node.id]:
                    old = store.db.execute("SELECT body FROM objects WHERE route=? AND kind='node' AND id=?", (route, node.id)).fetchone()
                    if old:
                        previous = json.loads(old[0])
                        if abs(previous['lon'] - node.lon) > 1e-7 or abs(previous['lat'] - node.lat) > 1e-7:
                            raise ValueError(f'PBF coordinate changed for saved node {node.id}')
                    store.put(route, obj)
                store.db.execute('INSERT OR REPLACE INTO nodetags VALUES(?,?)',
                                 (node.id, json.dumps(dict(node.tags), ensure_ascii=False)))
            absent_nodes = set(node_routes) - found
            geometry_nodes = {n for way in ways.values() for n in way['nodes']}
            if absent_nodes & geometry_nodes:
                raise ValueError(f'PBF way geometry is incomplete: {sorted(absent_nodes & geometry_nodes)[:20]}')
            if absent_nodes:
                quarantine(store, routes, {('node', ident) for ident in absent_nodes}, log)
        for route, wanted in missing.items():
            for ident in wanted['way'] & ways.keys():
                store.put(route, ways[ident])
        store.db.commit()
        log('Restriction completion checkpoint saved')


def validate(store, routes, log):
    for route in routes:
        log(f'{route}: checking all way/node and restriction references')
        count = 0
        for kind, body in store.db.execute(
                "SELECT kind,body FROM objects WHERE route=? AND kind!='node'", (route,)):
            obj = json.loads(body)
            if kind == 'way':
                refs = set(obj['nodes'])
                if len(obj['nodes']) < 2:
                    raise ValueError(f'Degenerate way {obj["id"]}')
                placeholders = ','.join('?' for _ in refs)
                present = store.db.execute(
                    f"SELECT count(*) FROM objects WHERE route=? AND kind='node' AND id IN ({placeholders})",
                    (route, *refs)).fetchone()[0]
                if present != len(refs):
                    raise ValueError(f'Way {obj["id"]}: missing nodes in saved database')
            else:
                allowed_missing = {(m['type'], m['ref'], m['role']) for m in obj.get('incomplete_members', [])}
                if allowed_missing and (not obj.get('routing_review_required') or set(obj.get('blocked_member_way_ids', [])) != {m['ref'] for m in obj['members'] if m['type']=='way'}):
                    raise ValueError(f'Restriction {obj["id"]}: invalid quarantine policy')
                for member in obj.get('members', []):
                    if not store.db.execute('SELECT 1 FROM objects WHERE route=? AND kind=? AND id=?',
                                            (route, member['type'], member['ref'])).fetchone():
                        if (member['type'], member['ref'], member['role']) not in allowed_missing:
                            raise ValueError(f'Restriction {obj["id"]}: unreported missing member')
            count += 1
            if count % 100000 == 0:
                log(f'{route}: checked {count:,} objects')
        if not store.counts(route).get('way'):
            raise ValueError(f'No roads for {route}')
