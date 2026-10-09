"""Compare saved shared OSM candidates, without routing or changing step 35."""
import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from step35_evidence import read, save, digest, csvfile, canonical, truth


def comparisons(records, queue):
    by_site = defaultdict(list)
    for record in records:
        by_site[record['site_id']].append(record)
    candidates = []
    for site_id, rows in sorted(by_site.items()):
        e = rows[0]
        if any(r['registry_operator'] != e['registry_operator'] or
               r['registry_point_powers_kw'] != e['registry_point_powers_kw']
               for r in rows):
            raise ValueError(f'Inconsistent identity evidence for {site_id}')
        live = [r for r in rows if r['identity_assessment'] != 'rejected_as_evidence']
        powers = set(e['registry_point_powers_kw']) & set(e['osm_connector_powers_kw'])
        address = e.get('address_comparison', {})
        address_matches = [k for k, v in address.items() if v.get('comparison') == 'same_text']
        address_differences = [k for k, v in address.items() if v.get('comparison') == 'different_text_review_required']
        cases = [queue[e['site_row'], r['direction']] for r in rows]
        priorities = [int(c['review_priority']) for c in cases]
        candidates.append({
            'site_id': site_id, 'site_row': e['site_row'],
            'registry_operator': e['registry_operator'], 'registry_address': e['registry_address'],
            'registry_point_powers_kw': e['registry_point_powers_kw'],
            'common_powers_kw': sorted(powers), 'same_area_ids': e['same_area_ids'],
            'same_layby_ids': e['same_layby_ids'], 'distance_m': e['distance_m'],
            'operator_assessment': e['operator_assessment'],
            'address_matches': address_matches, 'address_differences': address_differences,
            'directional_assessments': {r['direction']: r['identity_assessment'] for r in rows},
            'route_candidate_directions': sorted({r['direction'] for r in live if truth(r['mapped_route_usable_as_candidate'])}),
            'path_restrictions': {r['direction']: r['path_restrictions'] for r in rows if r['path_restrictions']},
            'rejection_reasons': sorted({reason for r in rows for reason in r['rejection_reasons']}),
            'rejected_in_all_directions': not live,
            'power_kw': float(cases[0]['power_kw']), 'fast_points': int(cases[0]['fast_points']),
            'review_priority': min(priorities),
            'long_gap_endpoint_km': sorted({gap for c in cases for gap in json.loads(c['long_gap_endpoint_km'])}, reverse=True),
            'association_verified': False, 'entrance_verified': False,
        })
    retained = [c for c in candidates if not c['rejected_in_all_directions']]
    supported = [c for c in retained if c['operator_assessment'] == 'compatible_name' and c['common_powers_kw']]
    if not retained:
        category = 'all_candidates_rejected_as_evidence'
    elif len(retained) == 1:
        category = 'one_remaining_candidate_unconfirmed'
    elif len({canonical(c['registry_operator']) for c in retained}) == 1 and all(canonical(c['registry_operator']) for c in retained):
        category = 'multiple_same_operator_pool_possible'
    else:
        category = 'multiple_candidates_unresolved'
    for c in candidates:
        c['other_compatible_power_sites'] = [s['site_id'] for s in supported if s['site_id'] != c['site_id']]
        c['area_competitors'] = [s['site_id'] for s in retained if s['site_id'] != c['site_id'] and set(s['same_area_ids']) & set(c['same_area_ids'])]
        c['same_address_competitors'] = [s['site_id'] for s in retained if s['site_id'] != c['site_id'] and s['registry_address'] == c['registry_address']]
        c['evidence_status'] = ('algorithm_rejected_as_evidence' if c['rejected_in_all_directions'] else
                                'operator_and_power_compatible_unconfirmed' if c in supported else
                                'insufficient_evidence_unconfirmed')
    return candidates, category


def analyse(source, output):
    source = Path(source).resolve(); output = Path(output).resolve()
    if output == source or output.is_relative_to(source):
        raise ValueError('Keep analysis outside the step 35 results')
    if (output / 'analysis-summary.json').exists():
        raise ValueError('Analysis already exists; use a new output folder')
    # Validate the delivered archive against the on-disk summaries before analysis.
    import zipfile
    with zipfile.ZipFile(source / '35-all-review-results.zip') as z:
        if z.testzip() is not None:
            raise ValueError('Input archive CRC failure')
        if json.loads(z.read('35-run-summary.json')) != read(source / '35-run-summary.json'):
            raise ValueError('Archive/run summary differs')
        for route in ('a5', 'a1', 'a9'):
            for name in ('identity-assessment.json', 'review-queue.csv'):
                if z.read(f'{route}/{name}') != (source / route / name).read_bytes():
                    raise ValueError(f'Archive/report differs: {route}/{name}')
    output.mkdir(parents=True, exist_ok=True)
    groups = []; flat = []; endpoints = []; totals = {}; inputs = {}
    for route in ('A5', 'A1', 'A9'):
        folder = source / route.lower()
        rp = folder / 'identity-assessment.json'; qp = folder / 'review-queue.csv'
        inputs[rp.relative_to(source).as_posix()] = digest(rp)
        inputs[qp.relative_to(source).as_posix()] = digest(qp)
        with qp.open(encoding='utf-8-sig', newline='') as f:
            queue_rows = list(csv.DictReader(f))
        queue = {(int(c['site_row']), c['direction']): c for c in queue_rows}
        endpoints.extend({**c, 'route': route} for c in queue_rows if int(c['review_priority']) == 0)
        by_osm = defaultdict(list)
        for e in read(rp):
            by_osm[e['osm_type'], e['osm_id']].append(e)
        route_groups = []
        for (kind, ident), records in sorted(by_osm.items()):
            if len({r['site_id'] for r in records}) < 2:
                continue
            candidates, category = comparisons(records, queue)
            expected_rows = {r['site_row'] for r in records}
            if any(set(r['shared_with_site_rows']) - expected_rows for r in records):
                raise ValueError(f'Incomplete competitor set for {route} {kind}/{ident}')
            tags = records[0]['osm_tags']
            group = {'route': route, 'osm_type': kind, 'osm_id': ident,
                     'site_ids': sorted({r['site_id'] for r in records}),
                     'directional_record_count': len(records), 'candidate_site_count': len(candidates),
                     'strong_shared_record_count': sum(r['identity_assessment'] == 'strong_candidate_shared_review' for r in records),
                     'category': category, 'review_priority': min(c['review_priority'] for c in candidates),
                     'osm_name': tags.get('name', ''), 'osm_operator': records[0]['osm_operator'],
                     'osm_powers_kw': records[0]['osm_connector_powers_kw'],
                     'osm_refs': {k: v for k, v in tags.items() if k == 'ref' or k.startswith('ref:')},
                     'osm_sockets': {k: v for k, v in tags.items() if k.startswith('socket:')},
                     'osm_capacity': tags.get('capacity'), 'osm_access': tags.get('access'),
                     'osm_opening_hours': tags.get('opening_hours'),
                     'registry_evse_comparison': 'not_available_in_step35',
                     'registry_connector_type_comparison': 'not_available_in_step35',
                     'candidates': candidates, 'association_verified': False, 'entrance_verified': False}
            route_groups.append(group)
            flat.extend({**c, 'route': route, 'osm_type': kind, 'osm_id': ident,
                         'group_category': category, 'osm_refs': group['osm_refs']} for c in candidates)
        strong = [g for g in route_groups if g['strong_shared_record_count']]
        totals[route] = {'shared_osm_objects': len(route_groups),
                         'strong_shared_records': sum(g['strong_shared_record_count'] for g in strong),
                         'strong_shared_osm_objects': len(strong),
                         'strong_shared_competitor_sets': len({tuple(g['site_ids']) for g in strong}),
                         'strong_shared_categories': dict(Counter(g['category'] for g in strong)),
                         'priority_zero_directional_cases': sum(int(c['review_priority']) == 0 for c in queue_rows),
                         'priority_zero_unique_sites': len({c['site_row'] for c in queue_rows if int(c['review_priority']) == 0}),
                         'registry_route_found_cases': sum(truth(c['road_route_found']) for c in queue_rows),
                         'registry_route_found_eligible_cases': sum(truth(c['road_route_found']) and truth(c['eligible_power']) for c in queue_rows)}
        groups.extend(route_groups)
    groups.sort(key=lambda g: (g['review_priority'], ('A5', 'A1', 'A9').index(g['route']), g['osm_type'], g['osm_id']))
    save(output / 'shared-groups.json', groups)
    compact = [{k: v for k, v in g.items() if k != 'candidates'} for g in groups]
    csvfile(output / 'shared-groups.csv', compact)
    csvfile(output / 'strong-shared-groups.csv', [g for g in compact if g['strong_shared_record_count']])
    csvfile(output / 'candidate-comparisons.csv', flat)
    csvfile(output / 'priority-zero-cases.csv', endpoints)
    summary = {'created_at': datetime.now(timezone.utc).isoformat(), 'routes': totals,
               'confirmed_associations': 0, 'confirmed_entrances': 0,
               'intervals_recalculated': False, 'routing_performed': False,
               'input_hashes': inputs, 'code_sha256': digest(Path(__file__)),
               'external_verification_performed': False}
    save(output / 'analysis-summary.json', summary)
    lines = ['# Разбор общих кандидатов шага 35', '',
             'Алгоритмическое сравнение сохранённых доказательств. Подтверждённых въездов и внешних подтверждений нет.', '',
             '| Трасса | Shared-записи strong | Уникальные OSM | Наборы конкурентов | Все общие OSM | Концы интервалов: случаи / площадки |',
             '|---|---:|---:|---:|---:|---:|']
    for route, t in totals.items():
        lines.append(f"| {route} | {t['strong_shared_records']} | {t['strong_shared_osm_objects']} | {t['strong_shared_competitor_sets']} | {t['shared_osm_objects']} | {t['priority_zero_directional_cases']} / {t['priority_zero_unique_sites']} |")
    lines += ['', '## Что установлено', '',
              'Повторы направлений убраны из списка конкурирующих площадок. Явные отклонения сохранены с исходными причинами.',
              'Совпадение оператора/мощностей, общей территории и адреса сравнивается между всеми конкурентами. При нескольких возможных соответствиях они сохраняются; назначение одному владельцу не выполняется.',
              'ref/EVSE и разъёмы OSM сохранены. Сопоставление с EVSE и типами оборудования реестра невозможно по одним отчётам шага 35 и отмечено как недостающие данные.', '',
              '## Первая очередь: общие объекты у концов длинных интервалов', '',
              '| Трасса | OSM | Площадки реестра | Категория |', '|---|---|---|---|']
    for g in [g for g in groups if g['review_priority'] == 0][:30]:
        rows = ', '.join(str(c['site_row']) for c in g['candidates'])
        lines.append(f"| {g['route']} | {g['osm_type']}/{g['osm_id']} | {rows} | {g['category']} |")
    lines += ['', 'Полный список концов интервалов, включая площадки без общих кандидатов: priority-zero-cases.csv.',
              'Следующий этап — проверка последних метров, доступа, часов и принадлежности с источником и датой. Карта, мощности, маршруты и интервалы не изменены.']
    (output / 'review.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(analyse(args.source, args.output), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
