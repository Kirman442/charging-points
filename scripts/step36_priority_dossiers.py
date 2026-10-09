"""Collect priority-zero saved path evidence; no routing, no PBF reads."""
import argparse
import csv
from collections import defaultdict
from pathlib import Path
from step35_evidence import read, save, digest


def collect(source, analysis):
    source = Path(source).resolve(); analysis = Path(analysis).resolve()
    if analysis == source or analysis.is_relative_to(source): raise ValueError('Separate analysis output required')
    if (analysis / 'priority-zero-dossiers.json').exists(): raise ValueError('Dossiers already exist')
    dossiers = []; inputs = {}
    for route in ('A5', 'A1', 'A9'):
        folder = source / route.lower()
        identities = defaultdict(list); paths = defaultdict(list)
        for e in read(folder / 'identity-assessment.json'): identities[e['site_row'], e['direction']].append(e)
        for c in read(folder / 'path-checks-enriched.json'): paths[c['site_row'], c['direction']].append(c)
        for name in ('review-queue.csv', 'identity-assessment.json', 'path-checks-enriched.json'):
            inputs[f'{route.lower()}/{name}'] = digest(folder / name)
        with (folder / 'review-queue.csv').open(encoding='utf-8-sig', newline='') as f:
            for c in csv.DictReader(f):
                if int(c['review_priority']) != 0: continue
                key = int(c['site_row']), c['direction']
                dossiers.append({'route': route, 'site': c, 'identity_candidates': identities[key],
                                 'path_checks': paths[key], 'remaining_checks':
                                 ['site_identity', 'last_metres_drivable', 'physical_access', 'opening_hours', 'same_direction_return'],
                                 'association_verified': False, 'entrance_verified': False})
    save(analysis / 'priority-zero-dossiers.json', {'input_hashes': inputs,
         'code_sha256': digest(Path(__file__)), 'directional_cases': len(dossiers),
         'unique_sites': len({d['site']['site_id'] for d in dossiers}), 'dossiers': dossiers})
    lines = ['# Первая очередь проверки въездов', '',
             'Сохранённые дорожные доказательства; последние метры и физический доступ не подтверждены.',
             'Данные реестра: 2026-09-01; OSM: 2026-10-06. Текущие внешние сведения могут описывать иной срез.', '']
    for d in dossiers:
        c = d['site']
        lines += [f"## {d['route']} {c['direction']} — площадка {c['site_row']}", '',
                  f"{c['operator']} — {c['address']}. Мощность установок {c['power_kw']} кВт; быстрых точек {c['fast_points']}.",
                  f"Координата: {c['longitude']}, {c['latitude']}. Длинные интервалы baseline: {c['long_gap_endpoint_km']} км.",
                  f"Путь к координате реестра: {c['road_route_found']}. Ниже — отдельные кандидаты OSM.", '']
        for e in d['identity_candidates']:
            ref = f"https://www.openstreetmap.org/{e['osm_type']}/{e['osm_id']}"
            lines += [f"- [{e['osm_type']}/{e['osm_id']}]({ref}): {e['osm_operator']}; {e['distance_m']} м от реестра; {e['identity_assessment']}. Мощности разъёмов OSM: {e['osm_connector_powers_kw']}; причины: {e['rejection_reasons']}."]
        lines += ['', '| Цель | Плечо | Подъезд, м | Возврат, м | Привязка, м | Конец на дороге |', '|---|---|---:|---:|---:|---|']
        for p in d['path_checks']:
            target = 'реестр' if p['target_kind'] == 'registry_coordinate' else f"{p.get('osm_type')}/{p.get('osm_id')}"
            lines += [f"| {target} | {p['leg']} | {p.get('access_m')} | {p.get('return_m')} | {p.get('snap_m')} | {p.get('road_terminal')} |"]
        lines += ['', f"Ограничения к координате: `{c['registry_path_restrictions']}`.",
                  f"Ограничения путей кандидатов: `{c['candidate_path_restrictions']}`.",
                  'Проверить отдельно: принадлежность, последние метры до места зарядки, фактический въезд, часы и условия доступа, возврат на своё направление. Отсутствие тегов не доказывает отсутствие ограничений.', '']
    (analysis / 'priority-zero-dossiers.md').write_text('\n'.join(lines), encoding='utf-8')
    return len(dossiers)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True); parser.add_argument('--analysis', type=Path, required=True)
    args = parser.parse_args(); print('Dossiers:', collect(args.source, args.analysis))
