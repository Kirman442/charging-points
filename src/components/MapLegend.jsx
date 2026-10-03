import { format } from '../utils/format.js'
import { createLayers } from '../map/layers.js'
const bands = [['≤ 22 kW','#40b8ad'],['> 22–< 50 kW','#54a1e5'],['50–< 150 kW','#f0c55b'],['≥ 150 kW','#f47a61']]
export default function MapLegend({ regions, options }) {
  // Share the exact domain used by the region layer, including state selection.
  const { maximum } = createLayers(null, regions, { ...options, showSites: false })
  return <aside className="panel map-legend" aria-label="Легенда карты">
    {options.showSites && <section><h2>Максимальная мощность точки</h2><div className="power-bands">{bands.map(([label,color]) => <div key={label}><i style={{ background: color }} />{label}</div>)}</div></section>}
    {options.metric !== 'sites' && <section><h2>{options.metric === 'ratio' ? 'Точки на 1 000 BEV' : 'Число BEV'}</h2><div className="gradient" /><div className="scale-labels"><span>0</span><span>{format(maximum)}</span></div><p className="note">{options.metric === 'ratio' || options.territory !== 'districts' ? 'Заливка по землям.' : 'Заливка по районам KBA.'} Шкала для выбранной территории.</p></section>}
    {!options.showSites && options.metric === 'sites' && <p className="note">Маркеры скрыты. Выборка сохранена.</p>}
  </aside>
}
