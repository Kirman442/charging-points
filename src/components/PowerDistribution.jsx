import { useId } from 'react'
import { POWER_BANDS } from '../data/pointSelection.js'
import { format } from '../utils/format.js'
export default function PowerDistribution({ summary, open = false, onOpen }) {
  const id = useId()
  const counts = summary.powerBands || [0,0,0,0]
  return <section className="power-distribution" aria-label="Распределение зарядных точек по мощности"><h3><button type="button" className="distribution-toggle" aria-expanded={open} aria-controls={id} onClick={() => onOpen?.(!open)}><span>Распределение точек по мощности</span><span aria-hidden="true">{open ? '−' : '+'}</span></button></h3>
    <div id={id} hidden={!open}>
    {summary.points > 0 ? <ul>{POWER_BANDS.map((band, index) => {
      const share = counts[index] / summary.points * 100
      return <li key={band.label}><div className="power-distribution-row"><span>{band.label}</span><strong>{format(counts[index])} <small>· {format(share)} %</small></strong></div><div className="operator-bar" aria-hidden="true"><span style={{ width: `${share}%`, background: band.color }} /></div></li>
    })}</ul> : <p className="note">Нет точек, соответствующих фильтрам.</p>}
    <p className="note">Максимальная мощность каждой точки. Учитываются только точки текущей выборки.</p>
    </div>
  </section>
}
