import { METRIC_CHOICES } from '../map/settings.js'
import { AUTOBAHNS } from '../data/autobahn.js'
import Switch from './Switch.jsx'
import Icon from './Icon.jsx'
export default function ControlPanel({ states, filters, onFilters, options, onOptions, onReset, a9Enabled, a9Direction, hideOthers, a9Available, onA9Enabled, onA9Direction, onHideOthers, autobahnRoute = 'A9', onAutobahnRoute, onClose, onLegend, mobile, onApply, initialTab = 'filters', onTab }) {
  const tab = initialTab
  const change = (key, value) => onFilters({ ...filters, [key]: value })
  const tabs = [{ id: 'filters', text: 'Фильтры', icon: 'filter' }, { id: 'layers', text: 'Слои', icon: 'layers' }, { id: 'road', text: 'Автобаны', icon: 'road' }]
  return <aside className="panel control-panel" aria-label="Настройки карты">
    <header className="panel-heading"><span className="eyebrow">НАСТРОЙКИ</span><button className="icon-button" onClick={onClose} aria-label="Закрыть настройки"><Icon name="close" /></button></header>
    <nav className="control-tabs" aria-label="Раздел настроек">{tabs.map(item => <button key={item.id} aria-pressed={tab === item.id} onClick={() => onTab(item.id)}><Icon name={item.icon} />{item.text}</button>)}</nav>
    <div className="control-scroll">
      {tab === 'filters' && <fieldset className="controls"><legend>Выборка инфраструктуры</legend>
        <label>Земля<select value={a9Enabled ? '' : filters.state} disabled={a9Enabled} onChange={event => change('state', event.target.value)}><option value="">Вся Германия</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
        {a9Enabled && <p className="note">В режиме автобана показ охватывает всё выбранное направление.</p>}
        <label>Минимальная мощность<select value={filters.minPower} onChange={event => change('minPower', Number(event.target.value))}>{[0,22,50,150,300].map(power => <option key={power} value={power}>{power ? `Точки ≥ ${power} кВт` : 'Любая мощность'}</option>)}</select></label>
        <Switch checked={filters.dcOnly} onChange={value => change('dcOnly', value)}>Только DC-точки</Switch>
        <Switch checked={filters.alwaysOpen} onChange={value => change('alwaysOpen', value)}>Вся площадка работает 24/7</Switch>
        <p className="note">Мощность и DC относятся к одной и той же точке. Часы работы относятся ко всей площадке.</p>
      </fieldset>}
      {tab === 'layers' && <fieldset className="controls"><legend>Отображение карты</legend>
        {!a9Enabled && <Switch checked={options.showSites} onChange={value => onOptions({ ...options, showSites: value })}>Зарядные площадки</Switch>}
        <Switch checked={options.clusterSites && !a9Enabled} disabled={a9Enabled} onChange={value => onOptions({ ...options, clusterSites: value })}>Группировать площадки</Switch>
        <label>Аналитический слой<select value={options.metric} disabled={a9Enabled} onChange={event => onOptions({ ...options, metric: event.target.value })}>{METRIC_CHOICES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {options.metric === 'concentration' && !a9Enabled && <label>Доля лидера по<select value={options.operatorBasis} onChange={event => onOptions({ ...options, operatorBasis: event.target.value })}><option value="points">Числу зарядных точек</option><option value="power">Номинальной мощности</option></select></label>}
        {options.metric !== 'sites' && options.metric !== 'concentration' && !a9Enabled && <label>Шкала сравнения<select value={options.scaleMode} onChange={event => onOptions({ ...options, scaleMode: event.target.value })}><option value="fixed">Фиксированная</option><option value="selection">По текущей выборке</option></select><span className="note scale-explanation">{options.scaleMode === 'fixed' ? 'Одинаковое значение сохраняет свой цвет при изменении фильтров. Удобно сравнивать разные выборки.' : 'Цвета растягиваются от нуля до максимума среди выбранных территорий. Удобно видеть различия внутри выборки. После изменения фильтров цвет того же значения может измениться.'} Меняется только раскраска, числа остаются прежними.</span></label>}
        <label>Территории<select value={a9Enabled ? 'states' : options.territory} disabled={a9Enabled} onChange={event => onOptions({ ...options, territory: event.target.value })}><option value="states">Земли</option><option value="districts">Районы KBA</option></select></label>
        <Switch checked={options.showBoundaries} onChange={value => onOptions({ ...options, showBoundaries: value })}>Показать границы</Switch>
      </fieldset>}
      {tab === 'road' && <fieldset className="controls"><legend>Анализ дорожного доступа</legend>
        <Switch checked={!!a9Enabled} disabled={!a9Available} onChange={onA9Enabled}>Режим автобана</Switch>
        {a9Enabled ? <>
          <label>Автобан<select value={autobahnRoute} onChange={event => onAutobahnRoute(event.target.value)}><option value="A1">A1</option><option value="A5">A5</option><option value="A9">A9</option></select></label>
          <label>Направление<select value={a9Direction} onChange={event => onA9Direction(event.target.value)}><option value="north">{AUTOBAHNS[autobahnRoute].north}</option><option value="south">{AUTOBAHNS[autobahnRoute].south}</option></select></label>
          <Switch checked={hideOthers} onChange={onHideOthers}>Скрыть площадки вне коридора</Switch>
          <p className="note">Цвет линии показывает расчётный интервал. Символы площадок показывают дорожную связь и условия доступа.</p>
        </> : <p className="note">Исследуйте интервалы между зарядными площадками вдоль A1, A5 и A9. Подъезд и возврат оцениваются по дорожной модели.</p>}
      </fieldset>}
    </div>
    <footer className="control-footer">{onLegend && <button className="settings-legend" onClick={onLegend}><Icon name="layers" />Легенда карты</button>}{mobile && tab !== 'filters' && <p className="note">Изменения отображения применяются сразу.</p>}{mobile && <button className="primary-button" onClick={tab === 'filters' ? onApply : onClose}>{tab === 'filters' ? 'Применить фильтры' : 'Готово'}</button>}<button className="reset" onClick={onReset}>Сбросить настройки</button></footer>
  </aside>
}
