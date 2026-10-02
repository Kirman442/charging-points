import { format } from '../utils/format.js'
const bands = [['≤ 22 kW','#40b8ad'],['> 22–< 50 kW','#54a1e5'],['50–< 150 kW','#f0c55b'],['≥ 150 kW','#f47a61']]
export default function ControlPanel({ data, regions, states, filters, onFilters, options, onOptions, status, error, onRetry, onReset }) {
  const state = regions?.states.find(feature => feature.properties.state_name === filters.state)?.properties
  const change = (key, value) => onFilters({ ...filters, [key]: value })
  return <aside className="panel overview">
    <div className="eyebrow">ЭЛЕКТРОМОБИЛЬНОСТЬ · ГЕРМАНИЯ</div><h1>Зарядная инфраструктура</h1>
    {data && <div className="stats"><div><strong>{format(data.count)}</strong><span>площадок в выборке</span></div><div><strong>{format(data.totalPoints)}</strong><span>точек на них</span></div></div>}
    {status !== 'Готово' && <p role="status">{status}</p>}
    {error && <div className="error" role="alert"><p>{error}</p><button onClick={onRetry}>Повторить загрузку</button></div>}
    <div className="controls">
      <label>Земля<select value={filters.state} onChange={event => change('state', event.target.value)}><option value="">Вся Германия</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
      <label>Минимальная мощность площадки<select value={filters.minPower} onChange={event => change('minPower', Number(event.target.value))}>{[0,22,50,150,300].map(power => <option key={power} value={power}>{power ? `Есть точка ≥ ${power} kW` : 'Любая мощность'}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={filters.dcOnly} onChange={event => change('dcOnly', event.target.checked)} />Есть DC-точки</label>
      <label className="check"><input type="checkbox" checked={filters.alwaysOpen} onChange={event => change('alwaysOpen', event.target.checked)} />Вся площадка работает 24/7</label>
      <p className="note">Фильтры выбирают площадки. Счётчик включает все точки выбранных площадок; мощность и DC могут относиться к разным точкам.</p>
      <label>Аналитический слой<select value={options.metric} onChange={event => onOptions({ ...options, metric: event.target.value })}><option value="sites">Зарядные площадки</option><option value="bev">Число BEV</option><option value="ratio">Точки на 1 000 BEV · земли</option></select></label>
      <label>Границы<select value={options.metric === 'ratio' ? 'states' : options.level} disabled={options.metric === 'ratio'} onChange={event => onOptions({ ...options, level: event.target.value })}><option value="none" disabled={options.metric !== 'sites'}>Скрыть</option><option value="states">Земли</option><option value="districts">Районы KBA</option></select></label>
      <label className="check"><input type="checkbox" checked={options.showSites} onChange={event => onOptions({ ...options, showSites: event.target.checked })} />Показать зарядные площадки</label>
      <label>Подложка<select value={options.style} onChange={event => onOptions({ ...options, style: event.target.value })}><option value="dark">Dark Matter</option><option value="light">Positron</option></select></label>
    </div>
    {state && <div className="region-summary"><h2>{state.state_name}</h2><p>BEV: <b>{format(state.bev_count)}</b></p><p>Все зарядные точки: <b>{format(state.points)}</b></p><p>Точек на 1 000 BEV: <b>{format(state.points_per_1000_bev)}</b></p></div>}
    {options.metric !== 'sites' && <div className="legend"><h2>{options.metric === 'ratio' ? 'Точки на 1 000 BEV' : 'Число BEV'}</h2><div className="gradient" /><p className="note">От меньшего к большему; шкала пересчитывается для видимых регионов.</p></div>}
    {options.showSites && <div className="legend"><h2>Максимальная мощность точки</h2>{bands.map(([label,color]) => <div key={label}><i style={{ background: color }} />{label}</div>)}</div>}
    <p className="note">Региональные показатели — по полному реестру, без фильтров площадок. BNetzA: 01.09.2026; BEV: 01.01.2026. Это отношение двух снимков, не оценка занятости.</p>
    <button className="reset" onClick={onReset}>Показать Германию</button>
  </aside>
}
