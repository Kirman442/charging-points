import Icon from './Icon.jsx'
import { format } from '../utils/format.js'
import { countWord } from '../utils/siteSelection.js'
export default function PanelShell({ mobile, state, onState, onClose, title, sites, points, routeSummary, pending, error, children, hidden }) {
  return <section className={`analytics-shell sheet-${state}`} hidden={hidden} aria-label="Информационная панель">
    <div className="sheet-actions">{mobile ? <><button className="sheet-expand" onClick={() => onState(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'half')} aria-label={state === 'peek' ? 'Развернуть информацию' : state === 'half' ? 'Открыть информацию на весь экран' : 'Уменьшить панель'}><span className="sheet-handle" /><span>{state === 'peek' ? 'Подробнее' : state === 'half' ? 'Развернуть' : 'Уменьшить'}</span></button>{state !== 'peek' && <button className="icon-button" aria-label="Свернуть информацию" onClick={() => onState('peek')}><Icon name="minus" /></button>}</> : <span className="shell-label">{title}</span>}<button className="icon-button" aria-label="Закрыть информационную панель" onClick={onClose}><Icon name="close" /></button></div>
    {mobile && state === 'peek' ? <div className="compact-summary"><h2>{title}</h2>{pending ? <p role="status">Загрузка…</p> : error ? <p role="alert">{error}</p> : <div className="compact-metrics">{routeSummary ? <><span><strong>{format(routeSummary.routed)}</strong> с маршрутом</span><span><strong>{format(routeSummary.eligible_routed)}</strong> для интервалов</span></> : <><span><strong>{format(sites)}</strong> {countWord(sites, ['площадка', 'площадки', 'площадок'])}</span><span><strong>{format(points)}</strong> {countWord(points, ['точка', 'точки', 'точек'])}</span></>}</div>}</div> : null}
    <div className="sheet-content" hidden={mobile && state === 'peek'}>{children}</div>
  </section>
}
