import { useI18n } from "../i18n/useI18n.js";
import { CONCENTRATION_THRESHOLD } from '../data/concentration.js';
import { METRICS } from '../data/analytics.js';
import { format } from '../utils/format.js';
import { createLayers } from '../map/layers.js';
import { paletteFor, POWER_LABELS as labels } from '../map/palette.js';
import Icon from './Icon.jsx';
import PrivacyLink from './PrivacyLink.jsx';
export default function MapLegend({
  regions,
  options,
  open = true,
  onToggle
}) {
  const {
    t,
    message
  } = useI18n();
  const {
    maximum
  } = createLayers(null, regions, {
    ...options,
    showSites: false
  });
  const palette = paletteFor(options.style);
  return <aside className={`panel map-legend${open ? ' is-open' : ''}`} aria-label={t("Легенда карты")}>
    <button className="legend-heading" onClick={onToggle} aria-expanded={open}><span>{message("{p0}Легенда карты", {
          p0: <Icon name="layers" />
        })}</span><Icon name="chevron" /></button>
    {open && <div className="legend-content">
      {options.showSites && <section><h3>{t("Максимум мощности точки")}</h3><div className="power-bands">{labels.map((label, index) => <div key={label}><i style={{
              background: palette.power[index]
            }} />{t(label)}</div>)}</div>{options.clusterSites && <p className="legend-cluster">{message("{p0} Число площадок в группе", {
            p0: <i style={{
              background: palette.cluster,
              color: palette.clusterText
            }} aria-hidden="true" />
          })}</p>}</section>}
      {options.metric !== 'sites' && <section><h3>{t(METRICS[options.metric].title)}</h3>{options.metric === 'concentration' ? <><p className="note">{options.operatorBasis === 'power' ? t("По номинальной мощности") : t("По числу зарядных точек")}</p><div className="concentration-key"><span>{message("{p0}Доля лидера ≤ {p1}%", {
                p0: <i className="concentration-normal" />,
                p1: CONCENTRATION_THRESHOLD
              })}</span><span>{message("{p0}Доля лидера > {p1}%", {
                p0: <i className="concentration-high" />,
                p1: CONCENTRATION_THRESHOLD
              })}</span><span>{message("{p0}Нет данных", {
                p0: <i className="concentration-missing" />
              })}</span></div><p className="note">{t("Порог — аналитический ориентир.")}</p></> : <><div className="gradient" style={{
            background: `linear-gradient(90deg,${palette.sequential.join(',')})`
          }} /><div className="scale-labels"><span>0</span><span>{options.scaleMode === 'fixed' ? '≥ ' : ''}{format(maximum)}</span></div><p className="note">{t(METRICS[options.metric].unit)}. {options.scaleMode === 'fixed' ? t("Общая шкала, верхние значения ограничены цветом.") : t("Шкала по текущей выборке.")}</p><div className="concentration-key"><span>{message("{p0}Нет данных для расчёта", {
                p0: <i className="concentration-missing" />
              })}</span></div></>}<p className="note">{options.territory === 'districts' ? t("Заливка по районам KBA.") : t("Заливка по землям.")}</p></section>}
      {!options.showSites && options.metric === 'sites' && <p className="note">{t("Маркеры скрыты. Выборка сохранена.")}</p>}
    <PrivacyLink className="privacy-mobile" /></div>}
  </aside>;
}
