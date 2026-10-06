import { AUTOBAHNS, A9_STATUS } from '../data/autobahn.js'
export default function AutobahnPanel({ pilot, direction, pending, error, onRetry, onSite, route = 'A9' }) {
  const summary = pilot?.summary.find(s => s.direction === direction)
  const sectionOrder = direction === 'north' ? { southern: 0, northern: 1 } : { northern: 0, southern: 1 }
  const candidates = pilot?.sites.filter(s => s.direction === direction && s.fast_points > 0).sort((a,b) => ((sectionOrder[a.section] || 0)-(sectionOrder[b.section] || 0)) || a.chain_m-b.chain_m) || []
  return <aside className="panel analytics-panel a9-panel" aria-label={`Анализ автобана ${route}`}>
    <header><div className="eyebrow">ПИЛОТ · АВТОБАН {route}</div><h2>{AUTOBAHNS[route][direction]}</h2></header>
    {pending && <p role="status">Загрузка маршрута {route}…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={onRetry}>Повторить загрузку {route}</button></div>}
    {summary && <>
      <p><strong>{summary.length_km.toLocaleString('ru-RU')} км</strong> · {route === 'A1' ? 'сумма длин двух раздельных участков направления' : 'расчётная длина направления'}</p>
      {pilot.sections && <><p className="note">A1 разделена реальным разрывом в Эйфеле. Интервалы считаются внутри каждого участка; через разрыв линия не проводится.</p><ul>{pilot.sections.filter(s => s.direction === direction).map(s => <li key={s.section}>{s.section === 'northern' ? 'Heiligenhafen — Blankenheim' : 'Kelberg — Saarbrücken'}: {s.length_km} км · максимальный расчётный интервал {s.max_gap_km ?? '—'} км</li>)}</ul></>}
      <p>{summary.candidates} площадок-кандидатов в коридоре поиска; {summary.routed} с найденными подъездом и возвратом.</p>
      {pilot.accessNetwork && <p>{summary.fast_routed} площадок с дорожной связью и DC-точкой ≥150 кВт.</p>}
      {pilot.accessNetwork && <p>{summary.eligible_routed} площадок с дорожной связью, ≥400 кВт и ≥1 DC-точкой на 150 кВт.</p>}
      {summary.max_gap_km !== null && <p>Максимальный расчётный интервал: <strong>{summary.max_gap_km} км</strong>.</p>}
      <p className="note">{pilot.accessNetwork ? 'Маршруты по OSM учитывают одностороннее движение, запреты поворотов и ограничения доступа. Въезды на сами площадки не проверены. Подъезд ≤3 км, возврат на своё направление ≤10 км; привязка к ближайшей дороге ≤60 м.' : 'Подъездная сеть ещё не проверена. Близость к A9 не подтверждает доступность с выбранного направления.'}</p>
      <p className="note">Срез зарядок: {pilot.sourceDate}. Это исследовательская оценка, не заключение о соответствии AFIR. Порог 50 км — наше предупреждение.</p>
      <p className="note">Базовые показатели относятся к полному исходному набору. Фильтры карты меняют только показ площадок.</p>
      <p className="note">Цветные интервалы рассчитаны между площадками с найденным маршрутом, ≥400 кВт и DC-точкой ≥150 кВт. Это не подтверждение доступности зарядки или соответствия AFIR. Светлые точки — кандидаты без найденного маршрута; бирюзовые — маршрут найден, въезд не проверен.</p>
      <div className="a9-key">{Object.entries(A9_STATUS).map(([key,s]) => <div key={key}><i className={`a9-line a9-${key}`} />{s.label}</div>)}</div>
      <details><summary>DC-площадки ≥150 кВт в коридоре ({candidates.length})</summary><ol className="a9-candidates">{candidates.map(s => <li key={s.site_row}><button type="button" className="a9-site-link" onClick={() => onSite(s.site_row, s.position)}>Открыть площадку · {s.section ? `${s.section === 'northern' ? 'северный' : 'южный'} участок · ` : ''}{(s.chain_m/1000).toFixed(1)} км</button> · {Math.round(s.power_kw)} кВт · {s.fast_points} быстрых точек<br /><small>{s.status === 'road_route_found_entrance_unverified' ? `Подъезд ${Math.round(s.access_m)} м; возврат ${Math.round(s.return_m)} м; до дороги ${s.snap_m} м — въезд не проверен` : 'Доступность не подтверждена'}</small></li>)}</ol></details>
    </>}
  </aside>
}
