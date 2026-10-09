import { useMemo } from 'react'
import { nearbySites } from '../map/nearby.js'
import { format } from '../utils/format.js'
import Icon from './Icon.jsx'
import { countWord } from '../utils/siteSelection.js'
export default function ResultsPanel({ data, center, onSelect, onRefresh }) {
  const rows = useMemo(() => nearbySites(data, center), [data, center])
  return <aside className="panel analytics-panel results-panel" aria-label="Площадки списком">
    <div className="eyebrow">ПЛОЩАДКИ СПИСКОМ</div><h2>Рядом с центром карты</h2>
    <p className="note">До 20 ближайших площадок текущей выборки. Расстояние по прямой, без расчёта подъезда.</p>
    <button className="secondary-button" onClick={onRefresh}><Icon name="target" />Обновить от центра карты</button>
    <ol className="site-results">{rows.map(row => <li key={row.rowIndex}><button onClick={() => onSelect(row)}><span className="result-power">До {format(row.power)} кВт</span><span className="result-count">{format(row.points)} {countWord(row.points, ['точка','точки','точек'])}</span><small>{row.latitude.toFixed(4)}, {row.longitude.toFixed(4)} <span>≈ {format(row.distance)} км</span></small></button></li>)}</ol>
    {!rows.length && <p role="status">Нет площадок для этой выборки.</p>}
  </aside>
}
