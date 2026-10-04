import { format } from '../utils/format.js'

export default function OperatorShares({ operators, basis, onBasis }) {
  const distribution = operators?.[basis]
  const valueLabel = value => basis === 'points' ? `${format(value)} точек` : `${format(value / 1000)} МВт`
  const row = (name, value, share) => <li key={name}>
    <div className="operator-row"><span className="operator-name">{name}</span><strong>{share == null ? '—' : `${format(share)} %`}</strong></div>
    <div className="operator-bar" aria-hidden="true"><span style={{ width: `${share ?? 0}%` }} /></div>
    <span className="operator-value">{valueLabel(value)}</span>
  </li>
  return <section className="operator-shares" aria-label="Доли зарядной инфраструктуры операторов">
    <h3>Операторы · доля инфраструктуры</h3>
    <label className="operator-basis">Сравнить по<select value={basis} onChange={event => onBasis(event.target.value)}><option value="points">Числу зарядных точек</option><option value="power">Номинальной мощности</option></select></label>
    {!distribution ? <p className="note">Подготовка данных об операторах…</p> : operators.count === 0 ? <p className="note">В текущей выборке нет зарядных площадок.</p> : <>
      <p className="note">Операторов: {format(operators.count)} · по текущей выборке</p>
      {distribution.total === 0 ? <p className="note">Суммарная мощность равна нулю; доли не рассчитываются.</p> : <ol className="operator-ranking">
        {distribution.leaders.map(entry => row(entry.name, entry.value, entry.share))}
        {distribution.others.count > 0 && row(`Остальные (${format(distribution.others.count)})`, distribution.others.value, distribution.others.share)}
      </ol>}
      <p className="note">По названиям операторов в реестре, без объединения в группы компаний. Доля точек или мощности, а не продаж энергии.</p>
    </>}
  </section>
}
