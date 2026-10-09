import { CONCENTRATION_THRESHOLD } from '../data/concentration.js'
import { METRICS } from '../data/analytics.js'
import { format } from '../utils/format.js'
import { createLayers } from '../map/layers.js'
import { paletteFor } from '../map/palette.js'
import Icon from './Icon.jsx'
const labels = ['≤ 22 кВт', '> 22–< 50 кВт', '50–< 150 кВт', '≥ 150 кВт']
export default function MapLegend({ regions, options, open = true, onToggle }) {
  const { maximum } = createLayers(null, regions, { ...options, showSites: false })
  const palette = paletteFor(options.style)
  return <aside className={`panel map-legend${open ? ' is-open' : ''}`} aria-label="Легенда карты">
    <button className="legend-heading" onClick={onToggle} aria-expanded={open}><span><Icon name="layers" />Легенда карты</span><Icon name="chevron" /></button>
    {open && <div className="legend-content">
      {options.showSites && <section><h3>Максимум мощности точки</h3><div className="power-bands">{labels.map((label,index) => <div key={label}><i style={{ background: palette.power[index] }} />{label}</div>)}</div>{options.clusterSites && <p className="legend-cluster"><i style={{ background: palette.cluster, color: palette.clusterText }}>12</i> Число площадок в группе</p>}</section>}
      {options.metric !== 'sites' && <section><h3>{METRICS[options.metric].title}</h3>{options.metric === 'concentration' ? <><p className="note">{options.operatorBasis === 'power' ? 'По номинальной мощности' : 'По числу зарядных точек'}</p><div className="concentration-key"><span><i className="concentration-normal" />Доля лидера ≤ {CONCENTRATION_THRESHOLD}%</span><span><i className="concentration-high" />Доля лидера &gt; {CONCENTRATION_THRESHOLD}%</span><span><i className="concentration-missing" />Нет данных</span></div><p className="note">Порог — аналитический ориентир.</p></> : <><div className="gradient" style={{ background: `linear-gradient(90deg,${palette.sequential.join(',')})` }} /><div className="scale-labels"><span>0</span><span>{options.scaleMode === 'fixed' ? '≥ ' : ''}{format(maximum)}</span></div><p className="note">{METRICS[options.metric].unit}. {options.scaleMode === 'fixed' ? 'Общая шкала, верхние значения ограничены цветом.' : 'Шкала по текущей выборке.'}</p><div className="concentration-key"><span><i className="concentration-missing" />Нет данных для расчёта</span></div></>}<p className="note">{options.territory === 'districts' ? 'Заливка по районам KBA.' : 'Заливка по землям.'}</p></section>}
      {!options.showSites && options.metric === 'sites' && <p className="note">Маркеры скрыты. Выборка сохранена.</p>}
    </div>}
  </aside>
}
