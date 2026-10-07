import { useId, useState } from 'react'
import { AUTOBAHNS, A9_STATUS } from '../data/autobahn.js'
export default function AutobahnPanel({ pilot, direction, pending, error, onRetry, onSite, route = 'A9', showUnrouted, onShowUnrouted }) {
  const [methodOpen, setMethodOpen] = useState(false)
  const methodId = useId()
  const summary = pilot?.summary.find(s => s.direction === direction)
  const sectionOrder = direction === 'north' ? { southern: 0, northern: 1 } : { northern: 0, southern: 1 }
  const candidates = pilot?.sites.filter(s => s.direction === direction && s.fast_points > 0).sort((a,b) => ((sectionOrder[a.section] || 0)-(sectionOrder[b.section] || 0)) || a.chain_m-b.chain_m) || []
  return <aside className="panel analytics-panel a9-panel" aria-label={`Анализ автобана ${route}`}>
    <header><div className="eyebrow">ПИЛОТ · АВТОБАН {route}</div><h2>{AUTOBAHNS[route][direction]}</h2></header>
    <label className="check a9-candidate-toggle"><input type="checkbox" checked={showUnrouted} onChange={event => onShowUnrouted(event.target.checked)} />Показать кандидатов без найденного маршрута</label>
    {pending && <p role="status">Загрузка маршрута {route}…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={onRetry}>Повторить загрузку {route}</button></div>}
    {summary && <>
      <p><strong>{summary.length_km.toLocaleString('ru-RU')} км</strong> · {route === 'A1' ? 'сумма длин двух раздельных участков направления' : 'расчётная длина направления'}</p>
      {pilot.sections && <><p className="note">A1 разделена реальным разрывом в Эйфеле. Интервалы считаются внутри каждого участка; через разрыв линия не проводится.</p><ul>{pilot.sections.filter(s => s.direction === direction).map(s => <li key={s.section}>{s.section === 'northern' ? 'Heiligenhafen — Blankenheim' : 'Kelberg — Saarbrücken'}: {s.length_km} км · максимальный расчётный интервал {s.max_gap_km ?? '—'} км</li>)}</ul></>}
      <p>{summary.candidates} площадок-кандидатов в коридоре поиска; {summary.routed} с найденными подъездом и возвратом.</p>
      {pilot.accessNetwork && <p>{summary.fast_routed} площадок с дорожной связью и DC-точкой ≥150 кВт.</p>}
      {pilot.accessNetwork && <p>{summary.eligible_routed} площадок с дорожной связью, ≥400 кВт и ≥1 DC-точкой на 150 кВт.</p>}
      {summary.max_gap_km !== null && <p>Максимальный расчётный интервал: <strong>{summary.max_gap_km} км</strong>.</p>}
      <div className="a9-key">{Object.entries(A9_STATUS).map(([key,s]) => <div key={key}><i className={`a9-line a9-${key}`} />{s.label}</div>)}</div>
      <div className="a9-key a9-point-key"><div><i className="a9-point a9-point-eligible" />Участвует в расчёте: маршрут найден, ≥400 кВт и DC ≥150 кВт</div><div><i className="a9-point" />Маршрут найден, мощности недостаточно для расчёта</div><div><i className="a9-point a9-point-unrouted" />Кандидат без найденного маршрута</div></div>
      <section className="power-distribution a9-method" aria-label="Методика и пояснения"><h3><button type="button" className="distribution-toggle" aria-expanded={methodOpen} aria-controls={methodId} onClick={() => setMethodOpen(open => !open)}><span>Методика и пояснения</span><span aria-hidden="true">{methodOpen ? '−' : '+'}</span></button></h3>
        <div id={methodId} hidden={!methodOpen}>
          <p className="note">Бирюзовые площадки с найденным маршрутом показаны сразу. Кандидаты без найденного маршрута включаются в правой панели. Реальные въезды требуют проверки. Группировка временно отключена.</p>
      <p className="note">{pilot.accessNetwork ? 'Маршруты по OSM учитывают одностороннее движение, запреты поворотов и ограничения доступа. Въезды на сами площадки не проверены. Подъезд ≤3 км, возврат на своё направление ≤10 км; привязка к ближайшей дороге ≤60 м.' : 'Подъездная сеть ещё не проверена. Близость к автобану не подтверждает доступность с выбранного направления.'}</p>
      <p className="note">Срез зарядок: {pilot.sourceDate}. Это исследовательская оценка, не заключение о соответствии AFIR. Порог 50 км — наше предупреждение.</p>
      <p className="note">Базовые показатели относятся к полному исходному набору. Фильтры карты меняют только показ площадок.</p>
      <p className="note">Цветные интервалы рассчитаны между площадками с найденным маршрутом, ≥400 кВт и DC-точкой ≥150 кВт. Это не подтверждение доступности зарядки или соответствия AFIR. Бирюзовые точки — маршрут найден, въезд не проверен. Обводка выделяет площадки, участвующие в расчёте интервалов. Чекбокс меняет только показ точек, интервалы не пересчитываются.</p>
        </div>
      </section>
      <details><summary>DC-площадки ≥150 кВт в коридоре ({candidates.length})</summary><ol className="a9-candidates">{candidates.map(s => <li key={s.site_row}><button type="button" className="a9-site-link" onClick={() => onSite(s.site_row, s.position)}>Открыть площадку · {s.section ? `${s.section === 'northern' ? 'северный' : 'южный'} участок · ` : ''}{(s.chain_m/1000).toFixed(1)} км</button> · {Math.round(s.power_kw)} кВт · {s.fast_points} быстрых точек<br /><strong className="a9-site-status">{s.status === 'road_route_found_entrance_unverified' ? 'Маршрут найден · въезд не проверен' : 'Маршрут не найден'}</strong><br /><small>{s.status === 'road_route_found_entrance_unverified' ? `Подъезд ${Math.round(s.access_m)} м; возврат ${Math.round(s.return_m)} м; до дороги ${s.snap_m} м` : 'Доступность неизвестна в пределах модели; это не доказательство отсутствия подъезда'}</small></li>)}</ol></details>
    </>}
  </aside>
}
