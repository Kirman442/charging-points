import { useI18n } from "../i18n/useI18n.js";
import Icon from './Icon.jsx';
import { format } from '../utils/format.js';
import { countWord } from '../utils/siteSelection.js';
export default function PanelShell({
  mobile,
  state,
  onState,
  onClose,
  title,
  sites,
  points,
  routeSummary,
  pending,
  error,
  children,
  hidden
}) {
  const {
    language,
    t,
    message
  } = useI18n();
  return <section className={`analytics-shell sheet-${state}`} hidden={hidden} aria-label={t("Информационная панель")}>
    <div className="sheet-actions">{mobile ? <><button className="sheet-expand" onClick={() => onState(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'half')} aria-label={state === 'peek' ? t("Развернуть информацию") : state === 'half' ? t("Открыть информацию на весь экран") : t("Уменьшить панель")}><span className="sheet-handle" /><span>{state === 'peek' ? t("Подробнее") : state === 'half' ? t("Развернуть") : t("Уменьшить")}</span></button>{state !== 'peek' && <button className="icon-button" aria-label={t("Свернуть информацию")} onClick={() => onState('peek')}><Icon name="minus" /></button>}</> : <span className="shell-label">{title}</span>}<button className="icon-button" aria-label={t("Закрыть информационную панель")} onClick={onClose}><Icon name="close" /></button></div>
    {mobile && state === 'peek' ? <div className="compact-summary"><h2>{title}</h2>{pending ? <p role="status">{t("Загрузка…")}</p> : error ? <p role="alert">{error}</p> : <div className="compact-metrics">{routeSummary ? <><span>{message("{p0} с маршрутом", {
              p0: <strong>{format(routeSummary.routed)}</strong>
            })}</span><span>{message("{p0} для интервалов", {
              p0: <strong>{format(routeSummary.eligible_routed)}</strong>
            })}</span></> : <><span><strong>{format(sites)}</strong> {countWord(sites, ['площадка', 'площадки', 'площадок'], language)}</span><span><strong>{format(points)}</strong> {countWord(points, ['точка', 'точки', 'точек'], language)}</span></>}</div>}</div> : null}
    <div className="sheet-content" hidden={mobile && state === 'peek'}>{children}</div>
  </section>;
}
