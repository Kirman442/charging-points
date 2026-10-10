import PowerDistribution from './PowerDistribution.jsx'
import AutobahnAccess from './AutobahnAccess.jsx'
import { territoryLabel } from '../utils/territory.js'
import OperatorShares from './OperatorShares.jsx'
import { memo, useId, useState } from 'react'
import { format } from '../utils/format.js'
import { siteSelectionText, countWord } from '../utils/siteSelection.js'
import { METRICS, metricValue, rankStates, summarizeStates } from '../data/analytics.js'
import Icon from './Icon.jsx'

function SiteContent({ site, autobahnSite }) {
  const selectionText = siteSelectionText(site)
  return <><div className="eyebrow">ЗАРЯДНАЯ ПЛОЩАДКА</div><h2>{site.city}</h2><div className="site-address"><span>{site.street} {site.house_number}</span><span className="muted">{site.postal_code} · {site.state_name}</span></div>
    <div className="site-highlights"><span><span className="highlight-icon" tabIndex={0} aria-label="Максимальная мощность одной зарядной точки" title="Максимальная мощность одной зарядной точки"><Icon name="bolt" />Max</span><strong>до {format(Math.max(0, ...site.available_power_kw))} кВт</strong></span><span><span className="highlight-icon" tabIndex={0} aria-label="Часы работы" title="Часы работы"><Icon name="clock" /></span><strong>{site.opening_hours_label}</strong></span></div>
    <SelectionStats sites={1} equipment={site.selected_equipment_count ?? site.equipment_count} points={site.selected_point_count ?? site.charging_point_count} showSites inflectLabels />
    {selectionText && <p className="note">{selectionText}</p>}
    <dl><dt>Оператор</dt><dd>{site.operator}</dd><dt>Мощность установок в выборке</dt><dd>{format(site.selected_power_kw ?? site.installed_power_kw)} кВт</dd><dt>Номинальная мощность всей площадки</dt><dd>{format(site.installed_power_kw)} кВт</dd><dt>Доступные мощности всей площадки</dt><dd>{site.available_power_kw.map(format).join(', ')} kW</dd><dt>Часы работы</dt><dd>{site.opening_hours_label}</dd><dt>Статус всех точек площадки</dt><dd>{site.operating_point_count} в эксплуатации; {site.maintenance_point_count} на обслуживании</dd><dt>Район</dt><dd>{site.district_name}</dd></dl>
    <AutobahnAccess site={autobahnSite} /><p className="note">Реестр не показывает текущую занятость или исправность точек.</p></>
}
function SelectionStats({ sites, equipment, points, showSites, sitesLabel = 'Площадки', inflectLabels = false }) {
  const helpId = useId()
  const counters = [
    { value: sites, label: inflectLabels ? countWord(sites, ['Площадка', 'Площадки', 'Площадок']) : sitesLabel, description: 'Площадка — сгруппированное место размещения зарядных установок.' },
    ...(equipment == null ? [] : [{ value: equipment, label: inflectLabels ? countWord(equipment, ['Установка', 'Установки', 'Установок']) : 'Установки', description: 'Ladeeinrichtung — отдельная зарядная установка, у которой может быть несколько зарядных точек.' }]),
    { value: points, label: inflectLabels ? countWord(points, ['Точка', 'Точки', 'Точек']) : 'Точки', description: 'Ladepunkt — зарядная точка для одного автомобиля одновременно.' },
  ]
  return <><div className={`selection-stats${equipment == null ? '' : ' three-counters'}`} aria-label="Зарядная инфраструктура в выборке">{counters.map((counter, index) => <div key={counter.label}><strong>{format(counter.value)}</strong><span><span className="term-help" tabIndex={0} aria-describedby={`${helpId}-${index}`} onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.blur() }}><span className="term-label">{counter.label}</span><span className="term-tooltip" role="tooltip" id={`${helpId}-${index}`}>{counter.description}</span></span></span></div>)}</div>{!showSites && <p className="note">Маркеры скрыты; выборка сохранена.</p>}</>
}
function SummaryGroups({ summary, metric }) {
  const groups = [
    { title: 'Автопарк', rows: [
      { label: 'Всего легковых автомобилей', value: format(summary.pkw_count) },
      { label: 'Легковые BEV', value: format(summary.bev_count), metric: 'bev' },
      { label: 'Доля BEV', value: summary.pkw_count > 0 ? `${format(summary.bev_count / summary.pkw_count * 100)} %` : '—' },
    ] },
    { title: 'Зарядная инфраструктура', rows: [
      { label: 'Номинальная мощность', value: `${format(summary.installed_power_kw / 1000)} МВт` },
      { label: 'Точки на 1 000 BEV', value: format(summary.points_per_1000_bev), metric: 'ratio' },
      { label: 'кВт на 1 000 BEV', value: format(summary.kw_per_1000_bev), metric: 'power' },
    ] },
  ]
  return <div className="analytics-groups">{groups.map(group => <section className="analytics-group" key={group.title} aria-label={group.title}><h3>{group.title}</h3><dl>{group.rows.map(row => <div key={row.label} className={row.metric === metric ? 'summary-row selected-metric' : 'summary-row'}><dt>{row.label}{row.metric === metric && <span className="sr-only"> — выбранная метрика карты</span>}</dt><dd>{row.value}</dd></div>)}</dl></section>)}</div>
}
function ClusterContent({ cluster, onZoom }) {
  return <><div className="eyebrow">ГРУППА ПЛОЩАДОК НА КАРТЕ</div><h2>Зарядная инфраструктура</h2>
    <SelectionStats sites={cluster.sites} points={cluster.points} showSites sitesLabel="площадок в группе" />
    <dl><dt>Максимальная мощность точки</dt><dd>{format(cluster.maxPower)} kW</dd></dl>
    <p className="note">Группа сформирована по текущим фильтрам и масштабу карты. Она может пересекать административные границы.</p>
    <button className="primary-button" onClick={onZoom}><Icon name="plus" />Приблизить группу</button><p className="note">Также можно приблизить двойным кликом по группе на карте.</p>
  </>
}
function RegionContent({ region, metric, showSites, operatorBasis, onOperatorBasis, distributionOpen, onDistributionOpen }) {
  return <><div className="eyebrow">{region.level === 'states' ? 'ЗЕМЛЯ' : 'ТЕРРИТОРИЯ KBA'}</div><h2>{region.state_name || region.display_name || region.district_name}</h2>{region.territory_type && <p className="muted">{territoryLabel(region.territory_type)}</p>}
    <SelectionStats sites={region.sites} equipment={region.equipment} points={region.points} showSites={showSites} />
    <SummaryGroups summary={region} metric={metric} />
    <PowerDistribution summary={region} open={distributionOpen} onOpen={onDistributionOpen} />
    <OperatorShares operators={region.operators} basis={operatorBasis} onBasis={onOperatorBasis} />
  </>
}
export function AnalyticsTabs({ activeTab, onTab, statesContent, operatorsContent }) {
  const id = useId()
  const tabs = [{ key: 'states', label: 'Статистика по землям' }, { key: 'operators', label: 'Статистика по операторам' }]
  const onKeyDown = (event, index) => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onTab(tabs[next].key)
    event.currentTarget.ownerDocument.getElementById(`${id}-${tabs[next].key}-tab`)?.focus()
  }
  return <div className="analytics-details">
    <div className="analytics-tabs" role="tablist" aria-label="Подробная статистика">{tabs.map((tab, index) => <button key={tab.key} id={`${id}-${tab.key}-tab`} type="button" role="tab" aria-selected={activeTab === tab.key} aria-controls={`${id}-panel`} tabIndex={activeTab === tab.key ? 0 : -1} onClick={() => onTab(tab.key)} onKeyDown={event => onKeyDown(event, index)}>{tab.label}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${activeTab}-tab`} tabIndex={0}>{activeTab === 'states' ? statesContent : operatorsContent}</div>
  </div>
}
function OverviewContent({ states, metric, data, showSites, onSelect, operatorBasis, onOperatorBasis, activeTab, onTab, distributionOpen, onDistributionOpen }) {
  const totals = summarizeStates(states)
  const ranked = rankStates(states, metric, operatorBasis)
  return <><div className="eyebrow">ОБЗОР ЗЕМЕЛЬ</div><h2>Германия</h2>
    <SelectionStats sites={data?.count ?? totals.sites} equipment={totals.equipment} points={data?.totalPoints ?? totals.points} showSites={showSites} />
    <SummaryGroups summary={totals} metric={metric} />
    <PowerDistribution summary={totals} open={distributionOpen} onOpen={onDistributionOpen} />
    <AnalyticsTabs activeTab={activeTab} onTab={onTab}
      operatorsContent={<OperatorShares operators={data?.regionStats?.nationalOperators} basis={operatorBasis} onBasis={onOperatorBasis} />}
      statesContent={<><p className="note">{METRICS[metric].title}{metric === 'concentration' ? (operatorBasis === 'power' ? ' · по мощности' : ' · по точкам') : ''} · нажми на строку для подробностей.</p>
        <ol className="region-ranking">{ranked.map((state, index) => <li key={state.state_code}><button onClick={() => onSelect(state)}><span className="rank">{index + 1}</span><span className="region-name">{state.state_name}</span><b>{format(metricValue(state, metric, operatorBasis))}{metric === 'concentration' ? ' %' : ''}</b></button></li>)}</ol></>}
    />
  </>
}
function AnalyticsPanel({ cluster, selectedState, states, site, autobahnSite, region, metric, pending, data, operatorBasis = 'points', onOperatorBasis, showSites, status, error, onRetry, onCloseSite, onAllTerritories, onOverview, onSelectRegion, onZoomCluster }) {
  const [activeTab, setActiveTab] = useState('states')
  const [distributionOpen, setDistributionOpen] = useState(false)
  return <aside className="panel analytics-panel" aria-label="Региональная аналитика" aria-busy={pending}>
    <header className="analytics-toolbar"><span>АНАЛИТИКА</span>{cluster || site || pending ? <button onClick={onCloseSite}>К аналитике</button> : region ? <button onClick={region.level === 'districts' && selectedState ? onAllTerritories : onOverview}>{region.level === 'districts' && selectedState ? 'Все территории' : 'Все земли'}</button> : <span className="muted">Текущая выборка</span>}</header>
    <div className="pending-line" role="status">{pending ? 'Загрузка новой площадки…' : ''}</div>
    <div className="analytics-scroll">
      {status && status !== 'Готово' && <p role="status">{status}</p>}
      {error && <div className="error" role="alert">{error} <button onClick={onRetry}>Повторить</button></div>}
      {cluster ? <ClusterContent cluster={cluster} onZoom={onZoomCluster} /> : site ? <SiteContent site={site} autobahnSite={autobahnSite} /> : region ? <RegionContent region={region} metric={metric} showSites={showSites} operatorBasis={operatorBasis} onOperatorBasis={onOperatorBasis} distributionOpen={distributionOpen} onDistributionOpen={setDistributionOpen} /> : states ? <OverviewContent states={states} metric={metric} data={data} showSites={showSites} onSelect={onSelectRegion} activeTab={activeTab} onTab={setActiveTab} operatorBasis={operatorBasis} onOperatorBasis={onOperatorBasis} distributionOpen={distributionOpen} onDistributionOpen={setDistributionOpen} /> : <p role="status">Подготовка региональной аналитики…</p>}
    </div>
    <footer><p className="note">BNetzA: 01.09.2026 · KBA: 01.01.2026</p><details className="analytics-method"><summary>Как считаются показатели</summary><p className="note">Площадки, установки и точки — по текущим фильтрам. BEV не фильтруются. Площадка объединяет установки; установка может иметь несколько точек. Одна точка заряжает один автомобиль одновременно.</p>{!site && !cluster && <p className="note">Мощность и DC фильтруют точки совместно. Считается полная номинальная мощность каждой установки с подходящей точкой — один раз, включая обслуживаемые установки. Фильтр 24/7 относится ко всей площадке. Мощность не показывает фактическую выдачу или число зарядок за день. BEV по 16 землям, без «Sonstige». Отношение двух снимков, не оценка занятости.</p>}</details></footer>
  </aside>
}

export default memo(AnalyticsPanel)
