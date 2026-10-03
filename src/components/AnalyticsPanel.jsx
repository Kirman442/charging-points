import { territoryLabel } from '../utils/territory.js'
import { memo } from 'react'
import { format } from '../utils/format.js'
import { METRICS, metricValue, rankStates, summarizeStates } from '../data/analytics.js'

function SiteContent({ site }) {
  return <><div className="eyebrow">ЗАРЯДНАЯ ПЛОЩАДКА</div><h2>{site.city}</h2><p>{site.street} {site.house_number}</p><p className="muted">{site.postal_code} · {site.state_name}</p>
    <dl><dt>Оператор</dt><dd>{site.operator}</dd><dt>Точки / оборудование</dt><dd>{site.charging_point_count} / {site.equipment_count}</dd><dt>Доступные мощности</dt><dd>{site.available_power_kw.map(format).join(', ')} kW</dd><dt>Часы работы</dt><dd>{site.opening_hours_label}</dd><dt>Статус в реестре</dt><dd>{site.operating_point_count} в эксплуатации; {site.maintenance_point_count} на обслуживании</dd><dt>Район</dt><dd>{site.district_name}</dd></dl>
    <p className="note">Реестр не показывает текущую занятость или исправность точек.</p></>
}
function SelectionStats({ sites, points, showSites, sitesLabel = 'площадок в выборке' }) {
  return <><div className="selection-stats"><div><strong>{format(sites)}</strong><span>{sitesLabel}</span></div><div><strong>{format(points)}</strong><span>зарядных точек</span></div></div>{!showSites && <p className="note">Маркеры скрыты; выборка сохранена.</p>}</>
}
function ClusterContent({ cluster }) {
  return <><div className="eyebrow">ГРУППА ПЛОЩАДОК НА КАРТЕ</div><h2>Зарядная инфраструктура</h2>
    <SelectionStats sites={cluster.sites} points={cluster.points} showSites sitesLabel="площадок в группе" />
    <dl><dt>Максимальная мощность точки</dt><dd>{format(cluster.maxPower)} kW</dd></dl>
    <p className="note">Группа сформирована по текущим фильтрам и масштабу карты. Она может пересекать административные границы.</p>
    <p>Двойной клик по группе на карте — приблизить и раскрыть её.</p>
  </>
}
function RegionContent({ region, metric, showSites }) {
  const definition = METRICS[metric]
  return <><div className="eyebrow">{region.level === 'states' ? 'ЗЕМЛЯ' : 'ТЕРРИТОРИЯ KBA'}</div><h2>{region.state_name || region.display_name || region.district_name}</h2>{region.territory_type && <p className="muted">{territoryLabel(region.territory_type)}</p>}
    <SelectionStats sites={region.sites} points={region.points} showSites={showSites} />
    {metric !== 'sites' && <div className="metric-card"><span>{definition.title}</span><strong>{format(metricValue(region, metric))}</strong><small>{definition.unit}</small></div>}
    
    <dl><dt>Код</dt><dd>{region.district_code || region.state_code}</dd><dt>Легковые BEV</dt><dd>{format(region.bev_count)}</dd><dt>Всего легковых автомобилей</dt><dd>{format(region.pkw_count)}</dd><dt>Доля BEV</dt><dd>{region.pkw_count > 0 ? `${format(region.bev_count / region.pkw_count * 100)} %` : '—'}</dd>
    <dt>Точки на 1 000 BEV</dt><dd>{format(region.points_per_1000_bev)}</dd></dl>
  </>
}
function OverviewContent({ states, metric, data, showSites, onSelect }) {
  const totals = summarizeStates(states)
  const ranked = rankStates(states, metric)
  const definition = METRICS[metric]
  return <><div className="eyebrow">ОБЗОР ЗЕМЕЛЬ</div><h2>Германия</h2><SelectionStats sites={data?.count ?? totals.sites} points={data?.totalPoints ?? totals.points} showSites={showSites} />{metric !== 'sites' && <div className="metric-card"><span>{definition.title}</span><strong>{format(metricValue(totals, metric))}</strong><small>{definition.unit}</small></div>}
    <p className="note">16 земель · нажми на строку для подробностей.</p>
    <ol className="region-ranking">{ranked.map((state, index) => <li key={state.state_code}><button onClick={() => onSelect(state)}><span className="rank">{index + 1}</span><span className="region-name">{state.state_name}</span><b>{format(metricValue(state, metric))}</b></button></li>)}</ol>
  </>
}
function AnalyticsPanel({ cluster, states, site, region, metric, pending, data, showSites, status, error, onRetry, onCloseSite, onOverview, onSelectRegion }) {
  return <aside className="panel analytics-panel" aria-label="Региональная аналитика" aria-busy={pending}>
    <header className="analytics-toolbar"><span>АНАЛИТИКА</span>{cluster || site || pending ? <button onClick={onCloseSite}>К аналитике</button> : region ? <button onClick={onOverview}>Все земли</button> : <span className="muted">Текущая выборка</span>}</header>
    <div className="pending-line" role="status">{pending ? 'Загрузка новой площадки…' : ''}</div>
    <div className="analytics-scroll">
      {status && status !== 'Готово' && <p role="status">{status}</p>}
      {error && <div className="error" role="alert">{error} <button onClick={onRetry}>Повторить</button></div>}
      {cluster ? <ClusterContent cluster={cluster} /> : site ? <SiteContent site={site} /> : region ? <RegionContent region={region} metric={metric} showSites={showSites} /> : states ? <OverviewContent states={states} metric={metric} data={data} showSites={showSites} onSelect={onSelectRegion} /> : <p role="status">Подготовка региональной аналитики…</p>}
    </div>
    <footer><p className="note">Площадки и зарядные точки — по текущим фильтрам. BEV не фильтруются. Зарядки: 01.09.2026; BEV: 01.01.2026.</p>{!site && !cluster && <p className="note">Фильтры выбирают площадки; считаются все точки на них. BEV по 16 землям, без «Sonstige». Отношение двух снимков, не оценка занятости.</p>}</footer>
  </aside>
}

export default memo(AnalyticsPanel)
