import { useI18n } from "../i18n/useI18n.js";
import { CONCENTRATION_THRESHOLD, operatorConcentration } from '../data/concentration.js';
import { format } from '../utils/format.js';
import { counted } from '../utils/siteSelection.js';
export default function OperatorShares({
  operators,
  basis,
  onBasis
}) {
  const {
    language,
    t,
    message
  } = useI18n();
  const distribution = operators?.[basis];
  const concentration = operatorConcentration(operators, basis);
  const valueLabel = (value, genitive = false) => basis === 'points' ? counted(value, genitive ? ['точки', 'точек', 'точек'] : ['точка', 'точки', 'точек'], language) : t("{p0} МВт", {
    p0: format(value / 1000)
  });
  const row = (name, value, share) => <li key={name}>
    <div className="operator-row"><span className="operator-name">{name}</span><strong>{share == null ? '—' : `${format(share)} %`}</strong></div>
    <div className="operator-bar" aria-hidden="true"><span style={{
        width: `${share ?? 0}%`
      }} /></div>
    <span className="operator-value">{valueLabel(value)}</span>
  </li>;
  return <section className="operator-shares" aria-label={t("Доли зарядной инфраструктуры операторов")}>
    <h3>{t("Операторы · доля инфраструктуры")}</h3>
    <label className="operator-basis">{message("Сравнить по{p0}", {
        p0: <select value={basis} onChange={event => onBasis(event.target.value)}><option value="points">{t("Числу зарядных точек")}</option><option value="power">{t("Номинальной мощности")}</option></select>
      })}</label>
    {!distribution ? <p className="note">{t("Подготовка данных об операторах…")}</p> : operators.count === 0 ? <p className="note">{t("В текущей выборке нет зарядных площадок.")}</p> : <>
      <p className="note">{message("Операторов: {p0} · по текущей выборке", {
          p0: format(operators.count)
        })}</p>
      {concentration && <div className={`concentration-card${concentration.high ? ' high-concentration' : ''}`}>
        <span className="concentration-status">{concentration.high ? t("Высокая концентрация инфраструктуры") : t("Доля лидера не превышает {p0}%", {
            p0: CONCENTRATION_THRESHOLD
          })}</span>
        <p className="concentration-leader">{concentration.name}</p><strong>{format(concentration.share)} %</strong><small>{t("доля крупнейшего оператора")}</small>
        <p className="note">{message("{p0} из {p1}", {
            p0: valueLabel(concentration.value),
            p1: valueLabel(concentration.total, true)
          })}</p>
        <p className="note">{message("При малом объёме выборки высокая доля может относиться лишь к нескольким установкам. Порог >{p0}% не определяет цены или нарушение конкуренции.", {
            p0: CONCENTRATION_THRESHOLD
          })}</p>
      </div>}
      {distribution.total === 0 ? <p className="note">{t("Суммарная мощность равна нулю; доли не рассчитываются.")}</p> : <ol className="operator-ranking">
        {distribution.leaders.map(entry => row(entry.name, entry.value, entry.share))}
        {distribution.others.count > 0 && row(t("Остальные ({p0})", {
          p0: format(distribution.others.count)
        }), distribution.others.value, distribution.others.share)}
      </ol>}
      <p className="note">{t("По подходящим точкам и установкам с такими точками. Названия из реестра, без объединения в группы компаний. Доля точек или мощности, а не продаж энергии.")}</p>
    </>}
  </section>;
}
