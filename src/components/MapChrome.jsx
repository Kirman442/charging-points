import Icon from './Icon.jsx'
import { METRIC_CHOICES } from '../map/settings.js'
import { AUTOBAHNS } from '../data/autobahn.js'
export default function MapChrome({ options, onOptions, filters, onFilters, controlsOpen, controlTab, onControls, onDirection, analyticsOpen, onAnalytics, onList, listOpen, onHome, onZoom, a9Enabled, route, direction, legendOpen, onLegend, modalOpen }) {
  const chips = [
    ...(!a9Enabled && filters.state ? [{ key: 'state', label: filters.state, value: '' }] : []),
    ...(filters.minPower ? [{ key: 'minPower', label: `≥ ${filters.minPower} кВт`, value: 0 }] : []),
    ...(filters.dcOnly ? [{ key: 'dcOnly', label: 'Только DC', value: false }] : []),
    ...(filters.alwaysOpen ? [{ key: 'alwaysOpen', label: '24/7', value: false }] : []),
  ]
  return <div className="map-chrome" inert={modalOpen || undefined}>
    <header className="app-toolbar">
      <div className="app-brand"><span className="brand-mark"><Icon name="bolt" /></span><div><h1>Зарядная инфраструктура</h1><p>Германия <span className="brand-divider">/</span> BNetzA + KBA</p></div></div>
      <div className="theme-toggle" role="group" aria-label="Тема карты"><button aria-label="Dark Matter, тёмная тема" aria-pressed={options.style === 'dark'} onClick={() => onOptions({ ...options, style: 'dark' })}><Icon name="moon" /><span>Тёмная</span></button><button aria-label="Positron, светлая тема" aria-pressed={options.style === 'light'} onClick={() => onOptions({ ...options, style: 'light' })}><Icon name="sun" /><span>Светлая</span></button></div>
    </header>
    <nav className="map-actions" aria-label="Панели карты">
      <button aria-expanded={controlsOpen && controlTab === 'filters'} onClick={() => onControls('filters')}><Icon name="filter" /><span>Фильтры</span>{chips.length > 0 && <b className="action-count">{chips.length}</b>}</button>
      <button aria-expanded={controlsOpen && controlTab === 'layers'} onClick={() => onControls('layers')}><Icon name="layers" /><span>Слои</span></button>
      <button aria-expanded={controlsOpen && controlTab === 'road'} onClick={() => onControls('road')}><Icon name="road" /><span>Автобаны</span></button>
      <button className="analytics-action" aria-expanded={analyticsOpen} onClick={onAnalytics}><Icon name="chart" /><span>Аналитика</span></button>
    </nav>
    <div className="map-context"><label className="layer-label quick-layer">{a9Enabled ? <><Icon name="road" /><span>{route}</span><select aria-label="Быстрое направление автобана" value={direction} onChange={event => onDirection(event.target.value)}><option value="north">{AUTOBAHNS[route].north}</option><option value="south">{AUTOBAHNS[route].south}</option></select></> : <><Icon name="layers" /><select aria-label="Быстрый аналитический слой" value={options.metric} onChange={event => onOptions({ ...options, metric: event.target.value })}>{METRIC_CHOICES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></>}</label>{chips.length > 0 && <div className="filter-chips" aria-label="Активные фильтры">{chips.map(chip => <button key={chip.key} onClick={() => onFilters({ ...filters, [chip.key]: chip.value })} aria-label={`Убрать фильтр: ${chip.label}`}>{chip.label}<Icon name="close" /></button>)}</div>}</div>
    <nav className="map-navigation" aria-label="Навигация по карте"><button className="icon-button" aria-label="Приблизить карту" onClick={() => onZoom(1)}><Icon name="plus" /></button><button className="icon-button" aria-label="Отдалить карту" onClick={() => onZoom(-1)}><Icon name="minus" /></button><span className="navigation-divider" /><button className="icon-button" aria-label="Показать весь маршрут или Германию" onClick={onHome}><Icon name="target" /></button><button className="icon-button" aria-label="Площадки списком" aria-pressed={listOpen} onClick={onList}><Icon name="list" /></button><button className="icon-button mobile-legend-action" aria-label="Легенда карты" aria-expanded={legendOpen} onClick={onLegend}><Icon name="layers" /></button></nav>
  </div>
}
