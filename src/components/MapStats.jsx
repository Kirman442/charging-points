import { format } from '../utils/format.js'
export default function MapStats({ data, showSites, status, error, onRetry }) {
  return <section className="panel map-stats" aria-label="Статистика выборки">
    <div className="stat"><strong>{data ? format(data.count) : '—'}</strong><span>площадок в выборке</span></div>
    <div className="stat"><strong>{data ? format(data.totalPoints) : '—'}</strong><span>точек на них</span></div>
    {!showSites && <span className="visibility-badge">Маркеры скрыты</span>}
    {status !== 'Готово' && <p className="status" role="status">{status}</p>}
    {error && <div className="error" role="alert">{error} <button onClick={onRetry}>Повторить</button></div>}
  </section>
}
