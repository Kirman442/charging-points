import { useI18n } from "../i18n/useI18n.js";
import Icon from './Icon.jsx';
import { METRIC_CHOICES } from '../map/settings.js';
import { AUTOBAHNS, autobahnDirections } from '../data/autobahn.js';
export default function MapChrome({
  options,
  onOptions,
  onQuickMetric,
  filters,
  onFilters,
  controlsOpen,
  controlTab,
  onControls,
  onDirection,
  analyticsOpen,
  onAnalytics,
  onList,
  listOpen,
  onHome,
  onZoom,
  a9Enabled,
  route,
  direction,
  legendOpen,
  onLegend,
  modalOpen
}) {
  const {
    language,
    setLanguage,
    t,
    message
  } = useI18n();
  const chips = [...(!a9Enabled && filters.state ? [{
    key: 'state',
    label: filters.state,
    value: ''
  }] : []), ...(filters.minPower ? [{
    key: 'minPower',
    label: t("≥ {p0} кВт", {
      p0: filters.minPower
    }),
    value: 0
  }] : []), ...(filters.dcOnly ? [{
    key: 'dcOnly',
    label: t("Только DC"),
    value: false
  }] : []), ...(filters.alwaysOpen ? [{
    key: 'alwaysOpen',
    label: '24/7',
    value: false
  }] : [])];
  return <div className="map-chrome" inert={modalOpen || undefined}>
    <header className="app-toolbar">
      <div className="app-brand"><span className="brand-mark"><Icon name="bolt" /></span><div><h1>{t("Зарядная инфраструктура")}</h1><p>{message("Германия {p0} BNetzA + KBA", {
              p0: <span className="brand-divider">/</span>
            })}</p></div></div>
      <div className="toolbar-preferences"><div className="language-toggle" role="group" aria-label={t('Язык интерфейса')}><button type="button" lang="de" aria-label="Deutsch" aria-pressed={language === 'de'} onClick={() => setLanguage('de')}>DE</button><button type="button" lang="ru" aria-label="Русский" aria-pressed={language === 'ru'} onClick={() => setLanguage('ru')}>RU</button></div><div className="theme-toggle" role="group" aria-label={t("Тема карты")}><button aria-label={t("Dark Matter, тёмная тема")} aria-pressed={options.style === 'dark'} onClick={() => onOptions({
            ...options,
            style: 'dark'
          })}><Icon name="moon" /></button><button aria-label={t("Positron, светлая тема")} aria-pressed={options.style === 'light'} onClick={() => onOptions({
            ...options,
            style: 'light'
          })}><Icon name="sun" /></button></div>
      </div></header>
    <nav className="map-actions" aria-label={t("Панели карты")}>
      <button aria-expanded={controlsOpen && controlTab === 'filters'} onClick={() => onControls('filters')}><Icon name="filter" /><span>{t("Фильтры")}</span>{chips.length > 0 && <b className="action-count">{chips.length}</b>}</button>
      <button aria-expanded={controlsOpen && controlTab === 'layers'} onClick={() => onControls('layers')}><Icon name="layers" /><span>{t("Слои")}</span></button>
      <button aria-expanded={controlsOpen && controlTab === 'road'} onClick={() => onControls('road')}><Icon name="road" /><span>{t("Автобаны")}</span></button>
      <button className="analytics-action" aria-expanded={analyticsOpen} onClick={onAnalytics}><Icon name="chart" /><span>{t("Аналитика")}</span></button>
    </nav>
    <div className="map-context"><label className="layer-label quick-layer">{a9Enabled ? <><Icon name="road" /><span>{route}</span><select aria-label={t("Быстрое направление автобана")} value={direction} onChange={event => onDirection(event.target.value)}>{autobahnDirections(route).map(value => <option key={value} value={value}>{t(AUTOBAHNS[route][value])}</option>)}</select></> : <><Icon name="layers" /><select aria-label={t("Быстрый аналитический слой")} value={options.metric} onChange={event => onQuickMetric(event.target.value)}>{METRIC_CHOICES.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</select></>}</label>{chips.length > 0 && <div className="filter-chips" aria-label={t("Активные фильтры")}>{chips.map(chip => <button key={chip.key} onClick={() => onFilters({
          ...filters,
          [chip.key]: chip.value
        })} aria-label={t("Убрать фильтр: {p0}", {
          p0: chip.label
        })}>{t(chip.label)}<Icon name="close" /></button>)}</div>}</div>
    <nav className="map-navigation" aria-label={t("Навигация по карте")}><button className="icon-button" aria-label={t("Приблизить карту")} onClick={() => onZoom(1)}><Icon name="plus" /></button><button className="icon-button" aria-label={t("Отдалить карту")} onClick={() => onZoom(-1)}><Icon name="minus" /></button><span className="navigation-divider" /><button className="icon-button" aria-label={t("Показать весь маршрут или Германию")} onClick={onHome}><Icon name="target" /></button><button className="icon-button" aria-label={t("Площадки списком")} aria-pressed={listOpen} onClick={onList}><Icon name="list" /></button><button className="icon-button mobile-legend-action" aria-label={t("Легенда карты")} aria-expanded={legendOpen} onClick={onLegend}><Icon name="layers" /></button></nav>
  </div>;
}
