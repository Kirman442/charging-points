export default function ControlPanel({ states, filters, onFilters, options, onOptions, onReset }) {
  const change = (key, value) => onFilters({ ...filters, [key]: value })
  return <aside className="panel control-panel" aria-label="Настройки карты">
    <header><div className="eyebrow">ЭЛЕКТРОМОБИЛЬНОСТЬ · ГЕРМАНИЯ</div><h1>Зарядная инфраструктура</h1></header>
    <div className="control-scroll">
      <fieldset className="controls"><legend>Выборка площадок</legend>
        <label>Земля<select value={filters.state} onChange={event => change('state', event.target.value)}><option value="">Вся Германия</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
        <label>Минимальная мощность<select value={filters.minPower} onChange={event => change('minPower', Number(event.target.value))}>{[0,22,50,150,300].map(power => <option key={power} value={power}>{power ? `Есть точка ≥ ${power} kW` : 'Любая мощность'}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={filters.dcOnly} onChange={event => change('dcOnly', event.target.checked)} />Есть DC-точки</label>
        <label className="check"><input type="checkbox" checked={filters.alwaysOpen} onChange={event => change('alwaysOpen', event.target.checked)} />Вся площадка работает 24/7</label>
        <label className="check"><input type="checkbox" checked={options.showSites} onChange={event => onOptions({ ...options, showSites: event.target.checked })} />Показать зарядные площадки</label>
        
      </fieldset>
      <fieldset className="controls"><legend>Отображение карты</legend>
        <label>Аналитический слой<select value={options.metric} onChange={event => onOptions({ ...options, metric: event.target.value })}><option value="sites">Зарядные площадки</option><option value="bev">Число BEV</option><option value="ratio">Точки на 1 000 BEV · земли</option></select></label>
        <label>Границы<select value={options.metric === 'ratio' ? 'states' : options.level} disabled={options.metric === 'ratio'} onChange={event => onOptions({ ...options, level: event.target.value })}><option value="none" disabled={options.metric !== 'sites'}>Скрыть</option><option value="states">Земли</option><option value="districts">Районы KBA</option></select></label>
        <label>Подложка<select value={options.style} onChange={event => onOptions({ ...options, style: event.target.value })}><option value="dark">Dark Matter</option><option value="light">Positron</option></select></label>
      </fieldset>
    </div>
    <button className="reset" onClick={onReset}>Сбросить выборку</button>
  </aside>
}
