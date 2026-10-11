import { useI18n } from "../i18n/useI18n.js";
import PowerDistribution from './PowerDistribution.jsx';
import AutobahnAccess from './AutobahnAccess.jsx';
import { territoryLabel } from '../utils/territory.js';
import OperatorShares from './OperatorShares.jsx';
import { Fragment, memo, useId, useState, useRef, useLayoutEffect } from 'react';
import { format } from '../utils/format.js';
import { siteSelectionText, countWord, sitePowerRows } from '../utils/siteSelection.js';
import { METRICS, metricValue, rankStates, summarizeStates } from '../data/analytics.js';
import Icon from './Icon.jsx';
import HelpTooltip from './HelpTooltip.jsx';
function SiteContent({
  site,
  autobahnSite
}) {
  const {
    language,
    t,
    message
  } = useI18n();
  const selectionText = siteSelectionText(site, language);
  return <><div className="eyebrow">{t("ЗАРЯДНАЯ ПЛОЩАДКА")}</div><h2>{site.city}</h2><div className="site-address"><span>{site.street} {site.house_number}</span><span className="muted">{site.postal_code} · {site.state_name}</span></div>
    <div className="site-highlights"><span><span className="highlight-icon" tabIndex={0} aria-label={t("Максимальная мощность одной зарядной точки")} title={t("Максимальная мощность одной зарядной точки")}><Icon name="bolt" />Max</span><strong>{message("до {p0} кВт", {
            p0: format(Math.max(0, ...site.available_power_kw))
          })}</strong></span><span><span className="highlight-icon" tabIndex={0} aria-label={t("Часы работы")} title={t("Часы работы")}><Icon name="clock" /></span><strong>{t(site.opening_hours_label)}</strong></span></div>
    <SelectionStats sites={1} equipment={site.selected_equipment_count ?? site.equipment_count} points={site.selected_point_count ?? site.charging_point_count} showSites inflectLabels />
    {selectionText && <p className="note">{selectionText}</p>}
    <dl><dt>{t("Оператор")}</dt><dd>{site.operator}</dd>{sitePowerRows(site, language).map(row => <Fragment key={t(row.label)}><dt>{t(row.label)}</dt><dd>{row.value}</dd></Fragment>)}<dt>{t("Статус всех точек площадки")}</dt><dd>{message("{p0} в эксплуатации; {p1} на обслуживании", {
          p0: site.operating_point_count,
          p1: site.maintenance_point_count
        })}</dd><dt>{t("Район")}</dt><dd>{site.district_name}</dd></dl>
    <AutobahnAccess site={autobahnSite} /><p className="note">{t("Реестр не показывает текущую занятость или исправность точек.")}</p></>;
}
function SelectionStats({
  sites,
  equipment,
  points,
  showSites,
  sitesLabel = 'Площадки',
  inflectLabels = false
}) {
  const {
    language,
    t
  } = useI18n();
  const counters = [{
    value: sites,
    label: inflectLabels ? countWord(sites, ['Площадка', 'Площадки', 'Площадок'], language) : sitesLabel,
    description: t("Площадка — сгруппированное место размещения зарядных установок.")
  }, ...(equipment == null ? [] : [{
    value: equipment,
    label: inflectLabels ? countWord(equipment, ['Установка', 'Установки', 'Установок'], language) : t("Установки"),
    description: t("Ladeeinrichtung — отдельная зарядная установка, у которой может быть несколько зарядных точек.")
  }]), {
    value: points,
    label: inflectLabels ? countWord(points, ['Точка', 'Точки', 'Точек'], language) : t("Точки"),
    description: t("Ladepunkt — зарядная точка для одного автомобиля одновременно.")
  }];
  return <><div className={`selection-stats${equipment == null ? '' : ' three-counters'}`} aria-label={t("Зарядная инфраструктура в выборке")}>{counters.map(counter => <div key={t(counter.label)}><strong>{format(counter.value)}</strong><span><span className="term-label">{t(counter.label)} <HelpTooltip label={t(counter.label)} text={t(counter.description)} /></span></span></div>)}</div>{!showSites && <p className="note">{t("Маркеры скрыты; выборка сохранена.")}</p>}</>;
}
function SummaryGroups({
  summary,
  metric
}) {
  const {
    t
  } = useI18n();
  const groups = [{
    title: t("Автопарк"),
    rows: [{
      label: t("Всего легковых автомобилей"),
      value: format(summary.pkw_count)
    }, {
      label: t("Легковые BEV"),
      value: format(summary.bev_count),
      metric: 'bev'
    }, {
      label: t("Доля BEV"),
      value: summary.pkw_count > 0 ? `${format(summary.bev_count / summary.pkw_count * 100)} %` : '—'
    }]
  }, {
    title: t("Зарядная инфраструктура"),
    rows: [{
      label: t("Номинальная мощность"),
      value: t("{p0} МВт", {
        p0: format(summary.installed_power_kw / 1000)
      })
    }, {
      label: t("Точки на 1 000 BEV"),
      value: format(summary.points_per_1000_bev),
      metric: 'ratio'
    }, {
      label: t("кВт на 1 000 BEV"),
      value: format(summary.kw_per_1000_bev),
      metric: 'power'
    }]
  }];
  return <div className="analytics-groups">{groups.map(group => <section className="analytics-group" key={t(group.title)} aria-label={t(group.title)}><h3>{t(group.title)}</h3><dl>{group.rows.map(row => <div key={t(row.label)} className={row.metric === metric ? 'summary-row selected-metric' : 'summary-row'}><dt>{t(row.label)}{row.metric === "ratio" && <HelpTooltip label={t("Точки на 1 000 BEV")} text={t("Число выбранных точек на 1 000 батарейных легковых автомобилей.")} />}{row.metric === "bev" && <HelpTooltip label="BEV" text={t("Батарейные легковые автомобили, без подключаемых гибридов.")} />}{row.metric === metric && <span className="sr-only">{t(" — выбранная метрика карты")}</span>}</dt><dd>{row.value}</dd></div>)}</dl></section>)}</div>;
}
function ClusterContent({
  cluster,
  onZoom
}) {
  const {
    t,
    message
  } = useI18n();
  return <><div className="eyebrow">{t("ГРУППА ПЛОЩАДОК НА КАРТЕ")}</div><h2>{t("Зарядная инфраструктура")}</h2>
    <SelectionStats sites={cluster.sites} points={cluster.points} showSites sitesLabel={t("площадок в группе")} />
    <dl><dt>{t("Максимальная мощность точки")}</dt><dd>{format(cluster.maxPower)} kW</dd></dl>
    <p className="note">{t("Группа сформирована по текущим фильтрам и масштабу карты. Она может пересекать административные границы.")}</p>
    <button className="primary-button" onClick={onZoom}>{message("{p0}Приблизить группу", {
        p0: <Icon name="plus" />
      })}</button><p className="note">{t("Также можно приблизить двойным кликом по группе на карте.")}</p>
  </>;
}
function RegionContent({
  region,
  metric,
  showSites,
  operatorBasis,
  onOperatorBasis,
  distributionOpen,
  onDistributionOpen
}) {
  const {
    t
  } = useI18n();
  return <><div className="eyebrow">{region.level === 'states' ? t("ЗЕМЛЯ") : t("ТЕРРИТОРИЯ KBA")}</div><h2>{region.state_name || region.display_name || region.district_name}</h2>{region.territory_type && <p className="muted">{t(territoryLabel(region.territory_type))}</p>}
    <SelectionStats sites={region.sites} equipment={region.equipment} points={region.points} showSites={showSites} />
    <SummaryGroups summary={region} metric={metric} />
    <PowerDistribution summary={region} open={distributionOpen} onOpen={onDistributionOpen} />
    <OperatorShares operators={region.operators} basis={operatorBasis} onBasis={onOperatorBasis} />
  </>;
}
export function AnalyticsTabs({
  activeTab,
  onTab,
  statesContent,
  operatorsContent
}) {
  const {
    t
  } = useI18n();
  const id = useId();
  const tabs = [{
    key: 'states',
    label: t("Статистика по землям")
  }, {
    key: 'operators',
    label: t("Статистика по операторам")
  }];
  const onKeyDown = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;else if (event.key === 'Home') next = 0;else if (event.key === 'End') next = tabs.length - 1;else return;
    event.preventDefault();
    onTab(tabs[next].key);
    event.currentTarget.ownerDocument.getElementById(`${id}-${tabs[next].key}-tab`)?.focus();
  };
  return <div className="analytics-details">
    <div className="analytics-tabs" role="tablist" aria-label={t("Подробная статистика")}>{tabs.map((tab, index) => <button key={tab.key} id={`${id}-${tab.key}-tab`} type="button" role="tab" aria-selected={activeTab === tab.key} aria-controls={`${id}-panel`} tabIndex={activeTab === tab.key ? 0 : -1} onClick={() => onTab(tab.key)} onKeyDown={event => onKeyDown(event, index)}>{t(tab.label)}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${activeTab}-tab`} tabIndex={0}>{activeTab === 'states' ? statesContent : operatorsContent}</div>
  </div>;
}
function OverviewContent({
  states,
  metric,
  data,
  showSites,
  onSelect,
  operatorBasis,
  onOperatorBasis,
  activeTab,
  onTab,
  distributionOpen,
  onDistributionOpen
}) {
  const {
    t,
    message
  } = useI18n();
  const totals = summarizeStates(states);
  const ranked = rankStates(states, metric, operatorBasis);
  return <><div className="eyebrow">{t("ОБЗОР ЗЕМЕЛЬ")}</div><h2>{t("Германия")}</h2>
    <SelectionStats sites={data?.count ?? totals.sites} equipment={totals.equipment} points={data?.totalPoints ?? totals.points} showSites={showSites} />
    <SummaryGroups summary={totals} metric={metric} />
    <PowerDistribution summary={totals} open={distributionOpen} onOpen={onDistributionOpen} />
    <AnalyticsTabs activeTab={activeTab} onTab={onTab} operatorsContent={<OperatorShares operators={data?.regionStats?.nationalOperators} basis={operatorBasis} onBasis={onOperatorBasis} />} statesContent={<><p className="note">{message("{p0}{p1} · нажми на строку для подробностей.", {
          p0: t(METRICS[metric].title),
          p1: metric === 'concentration' ? operatorBasis === 'power' ? t(" · по мощности") : t(" · по точкам") : ''
        })}</p>
        <ol className="region-ranking">{ranked.map((state, index) => <li key={state.state_code}><button onClick={() => onSelect(state)}><span className="rank">{index + 1}</span><span className="region-name">{state.state_name}</span><b>{format(metricValue(state, metric, operatorBasis))}{metric === 'concentration' ? ' %' : ''}</b></button></li>)}</ol></>} />
  </>;
}
function AnalyticsPanel({
  visible = true,
  closeSiteLabel = 'К аналитике',
  navigationRevision = 0,
  cluster,
  selectedState,
  states,
  site,
  autobahnSite,
  region,
  metric,
  pending,
  data,
  operatorBasis = 'points',
  onOperatorBasis,
  showSites,
  status,
  error,
  onRetry,
  onCloseSite,
  onAllTerritories,
  onOverview,
  onSelectRegion,
  onZoomCluster
}) {
  const {
    t
  } = useI18n();
  const [activeTab, setActiveTab] = useState('states');
  const [tabMetric, setTabMetric] = useState(metric);
  if (tabMetric !== metric) {
    setTabMetric(metric);
    if (metric === 'concentration') setActiveTab('operators');
  }
  const [distributionOpen, setDistributionOpen] = useState(false);
  const scrollRef = useRef(null),
    overviewScroll = useRef(0);
  const previousMetric = useRef(metric),
    metricScrollPending = useRef(false);
  const contentKey = cluster ? `cluster:${cluster.id}` : site ? `site:${site.site_id}` : region ? `${region.level}:${region.district_code || region.state_code}` : 'overview';
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = contentKey === 'overview' ? overviewScroll.current : 0;
  }, [contentKey, navigationRevision]);
  useLayoutEffect(() => {
    if (previousMetric.current !== metric) {
      previousMetric.current = metric;
      metricScrollPending.current = !site && !cluster;
    }
    // A mobile legend or compact sheet can hide the panel. Defer until visible.
    if (!metricScrollPending.current || !visible || site || cluster) return;
    const container = scrollRef.current;
    const target = metric === 'concentration' ? container?.querySelector('.operator-shares') : container;
    if (!container || !target) return;
    container.scrollTop = metric === 'concentration' ? container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top : 0;
    if (contentKey === 'overview') overviewScroll.current = container.scrollTop;
    metricScrollPending.current = false;
  }, [metric, visible, site, cluster, contentKey, states, activeTab]);
  return <aside className="panel analytics-panel" aria-label={t("Региональная аналитика")} aria-busy={pending}>
    <header className="analytics-toolbar"><span>{t("АНАЛИТИКА")}</span>{cluster || site || pending ? <button onClick={onCloseSite}>{closeSiteLabel}</button> : region ? <button onClick={region.level === 'districts' && selectedState ? onAllTerritories : onOverview}>{region.level === 'districts' && selectedState ? t("Все территории") : t("Все земли")}</button> : <span className="muted">{t("Текущая выборка")}</span>}</header>
    <div className="pending-line" role="status">{pending ? t("Загрузка новой площадки…") : ''}</div>
    <div className="analytics-scroll" ref={scrollRef} onScroll={event => {
      if (contentKey === 'overview') overviewScroll.current = event.currentTarget.scrollTop;
    }}>
      {status && <p role="status">{status}</p>}
      {error && <div className="error" role="alert">{error} <button onClick={onRetry}>{t("Повторить")}</button></div>}
      {cluster ? <ClusterContent cluster={cluster} onZoom={onZoomCluster} /> : site ? <SiteContent site={site} autobahnSite={autobahnSite} /> : region ? <RegionContent region={region} metric={metric} showSites={showSites} operatorBasis={operatorBasis} onOperatorBasis={onOperatorBasis} distributionOpen={distributionOpen} onDistributionOpen={setDistributionOpen} /> : states ? <OverviewContent states={states} metric={metric} data={data} showSites={showSites} onSelect={onSelectRegion} activeTab={activeTab} onTab={setActiveTab} operatorBasis={operatorBasis} onOperatorBasis={onOperatorBasis} distributionOpen={distributionOpen} onDistributionOpen={setDistributionOpen} /> : <p role="status">{t("Подготовка региональной аналитики…")}</p>}
      <details className="analytics-method"><summary>{t("Как считаются показатели")}</summary><p className="note">{t("Площадки, установки и точки — по текущим фильтрам. BEV не фильтруются. Площадка объединяет установки; установка может иметь несколько точек. Одна точка заряжает один автомобиль одновременно.")}</p>{!site && !cluster && <p className="note">{t("Мощность и DC фильтруют точки совместно. Считается полная номинальная мощность каждой установки с подходящей точкой — один раз, включая обслуживаемые установки. Фильтр 24/7 относится ко всей площадке. Мощность не показывает фактическую выдачу или число зарядок за день. BEV по 16 землям, без «Sonstige». Отношение двух снимков, не оценка занятости.")}</p>}</details>
    </div>
    <footer><p className="note">BNetzA: 01.09.2026 · KBA: 01.01.2026</p></footer>
  </aside>;
}
export default memo(AnalyticsPanel);
