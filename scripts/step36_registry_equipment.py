"""Enrich shared-candidate review from the local registry, without a road graph."""
import argparse
from collections import defaultdict
from pathlib import Path
from step35_evidence import read, save, digest, csvfile


def registry_family(label):
    label = label.casefold()
    if 'ccs' in label or 'combo' in label: return 'ccs'
    if 'chademo' in label: return 'chademo'
    if 'typ 2' in label or 'typ2' in label: return 'type2'
    if 'schuko' in label: return 'schuko'
    return 'unmapped:' + label


def enrich(analysis, points):
    import pyarrow.parquet as pq
    analysis = Path(analysis); points = Path(points)
    target = analysis / 'registry-equipment-comparison.json'
    if target.exists(): raise ValueError('Equipment comparison already exists; preserve it')
    groups = read(analysis / 'shared-groups.json')
    ids = sorted({c['site_id'] for g in groups for c in g['candidates']})
    columns = ['site_id', 'equipment_id', 'equipment_type', 'equipment_power_kw',
               'equipment_point_count', 'connector_types', 'connector_powers_kw', 'max_power_kw', 'has_dc']
    table = pq.read_table(points, columns=columns, filters=[('site_id', 'in', ids)])
    by_site = defaultdict(list)
    for r in table.to_pylist(): by_site[r['site_id']].append(r)
    inventory = {}
    for site_id in ids:
        rows = by_site[site_id]
        if not rows: raise ValueError(f'Missing registry points: {site_id}')
        equipment = {}
        for r in rows:
            item = {k: r[k] for k in ('equipment_id', 'equipment_type', 'equipment_power_kw', 'equipment_point_count')}
            if r['equipment_id'] in equipment and equipment[r['equipment_id']] != item:
                raise ValueError(f'Conflicting equipment attributes: {site_id}')
            equipment[r['equipment_id']] = item
        inventory[site_id] = {
            'equipment': list(equipment.values()), 'installation_count': len(equipment),
            'point_count': len(rows),
            'installed_power_kw': sum(e['equipment_power_kw'] for e in equipment.values()),
            'fast_points': sum(r['has_dc'] and r['max_power_kw'] >= 150 for r in rows),
            'connector_types': sorted({x for r in rows for x in (r['connector_types'] or [])}),
            'connector_powers_kw': sorted({x for r in rows for x in (r['connector_powers_kw'] or [])}),
            'point_max_powers_kw': sorted({r['max_power_kw'] for r in rows}),
        }
    comparisons = []
    for g in groups:
        osm_families = {family for socket, family in
                        [('type2_combo', 'ccs'), ('chademo', 'chademo'), ('type2', 'type2'), ('schuko', 'schuko')]
                        if g['osm_sockets'].get('socket:' + socket) not in (None, '0', 'no')}
        for c in g['candidates']:
            inv = inventory[c['site_id']]
            if abs(inv['installed_power_kw'] - c['power_kw']) > 0.001 or inv['fast_points'] != c['fast_points']:
                raise ValueError(f'Registry/report power binding differs: {c["site_id"]}')
            registry_families = {registry_family(x) for x in inv['connector_types']}
            comparisons.append({'route': g['route'], 'osm_type': g['osm_type'], 'osm_id': g['osm_id'],
                'site_id': c['site_id'], 'site_row': c['site_row'], 'review_priority': c['review_priority'],
                **inv, 'registry_connector_families': sorted(registry_families),
                'osm_connector_families': sorted(osm_families),
                'common_connector_families': sorted(registry_families & osm_families),
                'common_connector_powers_kw': sorted(set(inv['connector_powers_kw']) & set(g['osm_powers_kw'])),
                'osm_refs': g['osm_refs'], 'evse_comparison': 'registry_has_no_evse_column',
                'equipment_count_comparison': 'osm_object_may_represent_one_device_or_pool',
                'association_verified': False, 'entrance_verified': False})
    result = {'registry_sha256': digest(points), 'registry_columns': pq.read_schema(points).names,
              'shared_groups_sha256': digest(analysis / 'shared-groups.json'),
              'code_sha256': digest(Path(__file__)), 'unique_registry_sites': len(inventory),
              'comparisons': comparisons, 'confirmed_associations': 0, 'confirmed_entrances': 0}
    save(target, result); csvfile(analysis / 'registry-equipment-comparison.csv', comparisons)
    return {'unique_registry_sites': len(inventory), 'comparisons': len(comparisons)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--analysis', type=Path, required=True)
    parser.add_argument('--registry-points', type=Path, required=True)
    args = parser.parse_args()
    print(enrich(args.analysis, args.registry_points))
