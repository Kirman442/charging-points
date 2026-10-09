import { hasAccessConditions } from '../data/autobahnAccess.js'
import { useId, useState } from 'react'
import { AUTOBAHNS, A9_STATUS } from '../data/autobahn.js'

const number = value => value.toLocaleString('ru-RU')
const siteWord = count => {
  const lastTwo = count % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'площадок'
  const last = count % 10
  return last === 1 ? 'площадка' : last >= 2 && last <= 4 ? 'площадки' : 'площадок'
}

export default function AutobahnPanel({ pilot, direction, pending, error, onRetry, route = 'A9', showUnrouted, onShowUnrouted }) {
  const [methodOpen, setMethodOpen] = useState(false)
  const methodId = useId()
  const summary = pilot?.summary.find(s => s.direction === direction)
  const exitZones = pilot?.candidateMethod === 'all-exits-road-zones-v1' || (route === 'A5' && pilot?.candidateMethod === 'a5-all-exits-road-zones-v1')
  const directionSites = pilot?.sites.filter(s => s.direction === direction) || []
  const reviewSites = directionSites.filter(s => s.status === 'unconfirmed')
  const reviewFast = reviewSites.filter(s => s.fast_points > 0).length
  const excluded = directionSites.filter(s => s.status === 'distance_excluded').length
  const fastTotal = (summary?.fast_routed || 0) + reviewFast
  const accessConditionSites = directionSites.filter(hasAccessConditions)

  return <aside className="panel analytics-panel a9-panel" aria-label={`Анализ автобана ${route}`}>
    <header><div className="eyebrow">ПИЛОТ · АВТОБАН {route}</div><h2>{AUTOBAHNS[route][direction]}</h2></header>
    {pending && <p role="status">Загрузка маршрута {route}…</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={onRetry}>Повторить загрузку {route}</button></div>}
    {summary && <>
      <p><strong>{number(summary.length_km)} км</strong> · расчётная длина направления</p>
      <p className="note">Доступность по дорожной модели · OSM · 3 км / 3 км / 60 м</p>
      <section className="a9-summary-block" aria-label="Площадки с найденным маршрутом">
        <h3>Площадки с найденным маршрутом</h3>
        <p><strong>{number(summary.routed)}</strong> {siteWord(summary.routed)} с найденными подъездом и возвратом{pilot.accessNetwork ? ', из них:' : '.'}</p>
        {pilot.accessNetwork && <ul className="a9-summary-list">
          <li><strong>{number(summary.fast_routed)}</strong> {siteWord(summary.fast_routed)} с DC-точкой ≥150 кВт;</li>
          <li><strong>{number(summary.eligible_routed)}</strong> {siteWord(summary.eligible_routed)} с суммарной мощностью ≥400 кВт и хотя бы одной DC-точкой ≥150 кВт.</li>
        </ul>}
      </section>
      <div className="a9-key"><div><i className="a9-point a9-point-access" />Есть условия доступа — см. карточку</div></div>
      <section aria-label="Отдельные условия доступа">
        <p className="note">У {number(accessConditionSites.length)} площадок с найденным маршрутом отмечены отдельные условия доступа. На карте они обозначены квадратами; подробности — в карточке площадки. Эти признаки сами по себе не исключают площадку из интервалов.</p>
      </section>
      <section className="a9-review-block" aria-label="Площадки, требующие проверки">
        <p><strong>{number(reviewSites.length)}</strong> {siteWord(reviewSites.length)} {reviewSites.length % 10 === 1 && reviewSites.length % 100 !== 11 ? 'требует' : 'требуют'} проверки.</p>
        <label className="check a9-candidate-toggle"><input type="checkbox" checked={showUnrouted} onChange={event => onShowUnrouted(event.target.checked)} />Показать площадки, требующие проверки</label>
        <p className="note">Здесь проверяется дорожная связь. Фактические въезды отдельно не подтверждены и у площадок с найденным маршрутом.</p>
      </section>
      {summary.max_gap_km != null && <p className="a9-gap-summary">Максимальный расчётный интервал: <strong>{number(summary.max_gap_km)} км</strong>.</p>}
      <div className="a9-key">{Object.entries(A9_STATUS).map(([key, s]) => <div key={key}><i className={`a9-line a9-${key}`} />{s.label}</div>)}</div>
      <section className="power-distribution a9-method" aria-label="Методика и пояснения">
        <h3><button type="button" className="distribution-toggle" aria-expanded={methodOpen} aria-controls={methodId} onClick={() => setMethodOpen(open => !open)}><span>Методика и пояснения</span><span aria-hidden="true">{methodOpen ? '−' : '+'}</span></button></h3>
        <div id={methodId} hidden={!methodOpen}>
          {excluded > 0 && <p className="note">{number(excluded)} {siteWord(excluded)} {excluded % 10 === 1 && excluded % 100 !== 11 ? 'исключена' : 'исключены'} по длине подъезда в модели OSM. Они не показываются и не участвуют в интервалах.</p>}
          {pilot.accessNetwork && <div className="a9-count-explanation">
            <p className="note">Площадки с DC-точкой ≥150 кВт входят в указанные выше группы:</p>
            <ul className="a9-method-list note">
              <li>С найденным маршрутом: {number(summary.routed)}, из них {number(summary.fast_routed)} с DC-точкой ≥150 кВт. Остальные {number(summary.routed - summary.fast_routed)} не имеют DC-точки такой мощности.</li>
              <li>Требуют проверки: {number(reviewSites.length)}, из них {number(reviewFast)} с DC-точкой ≥150 кВт. Остальные {number(reviewSites.length - reviewFast)} не имеют DC-точки такой мощности.</li>
            </ul>
            <p className="note">Всего площадок с DC-точкой ≥150 кВт среди этих двух групп: {number(fastTotal)} = {number(summary.fast_routed)} + {number(reviewFast)}. Площадки, требующие проверки, не участвуют в расчёте интервалов.</p>
          </div>}
          {pilot.sections && <>
            <p className="note">Длина A1 — сумма длин двух раздельных участков направления. Между ними реальный разрыв в Эйфеле. Интервалы считаются внутри каждого участка; через разрыв линия не проводится.</p>
            <ul className="a9-method-list note">{pilot.sections.filter(s => s.direction === direction).map(s => <li key={s.section}>{s.section === 'northern' ? 'Heiligenhafen — Blankenheim' : 'Kelberg — Saarbrücken'}: {number(s.length_km)} км · максимальный расчётный интервал {s.max_gap_km == null ? '—' : number(s.max_gap_km)} км.</li>)}</ul>
          </>}
          {exitZones && <p className="note">Оба направления проверены отдельно от всех разрешённых ответвлений, включая площадки отдыха. В подъездной сети учитываются другие автобаны. Развязки помогают разбирать участки; отбор идёт по дорожному пути, а не по расстоянию вдоль {route}. Длинные подъезды исключены по диагностической сети OSM; это не заключение об отсутствии короткого пути на местности. Диагностическое снятие ограничений не подтверждает доступ.</p>}
          <p className="note">Бирюзовые площадки с найденным маршрутом показаны сразу. Площадки, требующие проверки, включаются чекбоксом в правой панели. Реальные въезды требуют проверки. Группировка временно отключена.</p>
          <div className="a9-key a9-point-key"><div><i className="a9-point a9-point-eligible" />Маршрут найден, ≥400 кВт и DC ≥150 кВт</div><div><i className="a9-point" />Маршрут найден, мощности недостаточно для расчёта</div><div><i className="a9-point a9-point-unrouted" />Площадка требует проверки</div></div>
          <p className="note">{pilot.accessNetwork ? 'Маршруты по OSM учитывают одностороннее движение, запреты поворотов и ограничения доступа. Подъезд ≤3 км, возврат на своё направление ≤3 км; привязка к ближайшей дороге ≤60 м. Это доступность по дорожной модели, а не подтверждение фактического въезда.' : 'Подъездная сеть ещё не проверена. Близость к автобану не подтверждает доступность с выбранного направления.'}</p>
          <p className="note">Шлагбаум, доступ для клиентов или разрешение владельца территории показываются отдельно. Неизвестные фактические условия не считаются автоматически запретом. Соседние зарядки OSM — дополнительные сведения: они не добавляют площадку в интервалы, а отклонённое сопоставление не отменяет её собственный маршрут.</p>
          <p className="note">Срез зарядок: {pilot.sourceDate}. Это исследовательская оценка, не заключение о соответствии AFIR. Порог 50 км — наше предупреждение.</p>
          <p className="note">Базовые показатели относятся к полному исходному набору. Фильтры карты меняют только показ площадок.</p>
          <p className="note">Интервал включает возврат предыдущей площадки, участок автобана и подъезд следующей. При несовместимых съезде и возврате интервал не рассчитан. Цветные интервалы рассчитаны между площадками с найденным маршрутом, ≥400 кВт и DC-точкой ≥150 кВт. Это не подтверждение доступности зарядки или соответствия AFIR. Бирюзовые точки — маршрут найден, въезд не проверен. Обводка выделяет площадки, участвующие в расчёте интервалов. Чекбокс меняет только показ точек, интервалы не пересчитываются.</p>
        </div>
      </section>
    </>}
  </aside>
}
