import { useI18n } from "../i18n/useI18n.js";
import { useMemo, useRef, useLayoutEffect } from 'react';
import { nearbySites } from '../map/nearby.js';
import { format } from '../utils/format.js';
import Icon from './Icon.jsx';
import { countWord } from '../utils/siteSelection.js';
export default function ResultsPanel({
  data,
  center,
  onSelect,
  onRefresh,
  scrollMemory,
  onScroll
}) {
  const {
    language,
    t,
    message
  } = useI18n();
  const rows = useMemo(() => nearbySites(data, center), [data, center]);
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollMemory?.current || 0;
  }, [scrollMemory]);
  return <aside className="panel analytics-panel results-panel" aria-label={t("Площадки списком")}>
    <div className="eyebrow">{t("ПЛОЩАДКИ СПИСКОМ")}</div><h2>{t("Рядом с центром карты")}</h2>
    <p className="note">{t("До 20 ближайших площадок текущей выборки. Расстояние по прямой, без расчёта подъезда.")}</p>
    <button className="secondary-button" onClick={() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      onRefresh();
    }}>{message("{p0}Обновить от центра карты", {
        p0: <Icon name="target" />
      })}</button>
    <ol className="site-results" ref={scrollRef} onScroll={event => onScroll?.(event.currentTarget.scrollTop)}>{rows.map(row => <li key={row.rowIndex}><button onClick={() => onSelect(row)}><span className="result-power">{message("До {p0} кВт", {
              p0: format(row.power)
            })}</span><span className="result-count">{format(row.points)} {countWord(row.points, ['точка', 'точки', 'точек'], language)}</span><small>{row.latitude.toFixed(4)}, {row.longitude.toFixed(4)} <span>{message("≈ {p0} км", {
                p0: format(row.distance)
              })}</span></small></button></li>)}</ol>
    {!rows.length && <p role="status">{t("Нет площадок для этой выборки.")}</p>}
  </aside>;
}
