import { AUTOBAHNS } from '../data/autobahn.js'
export default function ControlPanel({ states, filters, onFilters, options, onOptions, onReset, a9Enabled, a9Direction, hideOthers, a9Available, onA9Enabled, onA9Direction, onHideOthers, autobahnRoute = 'A9', onAutobahnRoute }) {
  const change = (key, value) => onFilters({ ...filters, [key]: value })
  return <aside className="panel control-panel" aria-label="Настройки карты">
    <header><div className="eyebrow">ЭЛЕКТРОМОБИЛЬНОСТЬ · ГЕРМАНИЯ</div><h1>Зарядная инфраструктура</h1></header>
    <div className="control-scroll">
      <fieldset className="controls"><legend>Автобаны · пилот</legend>
        <label>Автобан<select value={autobahnRoute} onChange={event => onAutobahnRoute(event.target.value)}><option value="A9">A9</option><option value="A1">A1</option></select></label>
        <label className="check"><input type="checkbox" checked={!!a9Enabled} disabled={!a9Available} onChange={event => onA9Enabled(event.target.checked)} />Режим «Автобан {autobahnRoute}»</label>
        {a9Enabled && <>
          <label>Направление<select value={a9Direction} onChange={event => onA9Direction(event.target.value)}><option value="north">{AUTOBAHNS[autobahnRoute].north}</option><option value="south">{AUTOBAHNS[autobahnRoute].south}</option></select></label>
          <label className="check"><input type="checkbox" checked={hideOthers} onChange={event => onHideOthers(event.target.checked)} />Скрыть площадки вне коридора поиска</label>
          <p className="note">Бирюзовые площадки с найденным маршрутом показаны сразу. Кандидаты без найденного маршрута включаются в правой панели. Реальные въезды требуют проверки. Группировка временно отключена.</p>
        </>}
      </fieldset>
      <fieldset className="controls"><legend>Выборка инфраструктуры</legend>
        <label>Земля<select value={filters.state} onChange={event => change('state', event.target.value)}><option value="">Вся Германия</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
        <label>Минимальная мощность<select value={filters.minPower} onChange={event => change('minPower', Number(event.target.value))}>{[0,22,50,150,300].map(power => <option key={power} value={power}>{power ? `Точки ≥ ${power} kW` : 'Любая мощность'}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={filters.dcOnly} onChange={event => change('dcOnly', event.target.checked)} />Только DC-точки</label>
        <label className="check"><input type="checkbox" checked={filters.alwaysOpen} onChange={event => change('alwaysOpen', event.target.checked)} />Вся площадка работает 24/7</label>
        {!a9Enabled && <label className="check"><input type="checkbox" checked={options.showSites} onChange={event => onOptions({ ...options, showSites: event.target.checked })} />Показать зарядные площадки</label>}
        
      </fieldset>
      <fieldset className="controls"><legend>Отображение карты</legend>
        <label className="check"><input type="checkbox" checked={options.clusterSites && !a9Enabled} disabled={a9Enabled} onChange={event => onOptions({ ...options, clusterSites: event.target.checked })} />Группировать площадки</label>
        <label>Аналитический слой<select value={options.metric} disabled={a9Enabled} onChange={event => onOptions({ ...options, metric: event.target.value })}><option value="sites">Зарядные площадки</option><option value="bev">Число BEV</option><option value="ratio">Точки на 1 000 BEV</option><option value="power">кВт на 1 000 BEV</option><option value="concentration">Концентрация операторов</option></select></label>
        {options.metric === 'concentration' && <label>Доля лидера по<select value={options.operatorBasis} onChange={event => onOptions({ ...options, operatorBasis: event.target.value })}><option value="points">Числу зарядных точек</option><option value="power">Номинальной мощности</option></select></label>}
        <label>Территории<select value={options.territory} onChange={event => onOptions({ ...options, territory: event.target.value })}><option value="states">Земли</option><option value="districts">Районы KBA</option></select></label>
        <label className="check"><input type="checkbox" checked={options.showBoundaries} onChange={event => onOptions({ ...options, showBoundaries: event.target.checked })} />Показать границы</label>
        <label>Подложка<select value={options.style} onChange={event => onOptions({ ...options, style: event.target.value })}><option value="dark">Dark Matter</option><option value="light">Positron</option></select></label>
      </fieldset>
    </div>
    <button className="reset" onClick={onReset}>Сбросить настройки</button>
  </aside>
}
