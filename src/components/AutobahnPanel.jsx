import { useI18n } from "../i18n/useI18n.js";
import { hasAccessConditions } from '../data/autobahnAccess.js';
import { useId, useState } from 'react';
import { AUTOBAHNS, A9_STATUS } from '../data/autobahn.js';
import Switch from './Switch.jsx';
import HelpTooltip from './HelpTooltip.jsx';
import { countWord } from '../utils/siteSelection.js';
import { paletteFor, POWER_LABELS } from '../map/palette.js';
export default function AutobahnPanel({
  pilot,
  direction,
  pending,
  error,
  onRetry,
  route = 'A9',
  style = 'dark',
  showUnrouted,
  onShowUnrouted,
  selectedSegment
}) {
  const {
    language,
    t,
    message
  } = useI18n();
  const number = value => value.toLocaleString(language === 'de' ? 'de-DE' : 'ru-RU');
  const siteWord = (count, dative = false) => language === 'de' && dative && count !== 1 ? 'Standorten' : countWord(count, ['площадка', 'площадки', 'площадок'], language);
  const [methodOpen, setMethodOpen] = useState(false);
  const methodId = useId();
  const [legendOpen, setLegendOpen] = useState(false);
  const legendId = useId();
  const palette = paletteFor(style);
  const summary = pilot?.summary.find(s => s.direction === direction);
  const exitZones = pilot?.candidateMethod === 'all-exits-road-zones-v1' || route === 'A5' && pilot?.candidateMethod === 'a5-all-exits-road-zones-v1';
  const directionSites = pilot?.sites.filter(s => s.direction === direction) || [];
  const reviewSites = directionSites.filter(s => s.status === 'unconfirmed');
  const reviewFast = reviewSites.filter(s => s.fast_points > 0).length;
  const excluded = directionSites.filter(s => s.status === 'distance_excluded').length;
  const fastTotal = (summary?.fast_routed || 0) + reviewFast;
  const accessConditionSites = directionSites.filter(hasAccessConditions);
  return <aside className="panel analytics-panel a9-panel" aria-label={t("Анализ автобана {p0}", {
    p0: route
  })}>
    <header><div className="eyebrow">{message("АВТОБАН {p0} · Beta", {
          p0: route
        })}<HelpTooltip symbol="ⓘ" label={t('Информация о Beta-версии')} text={t('Эта версия развивается. Дорожная связь рассчитывается по данным OSM; фактические въезды не подтверждены.')} /></div><h2>{t(AUTOBAHNS[route][direction])}</h2></header>
    {pending && <p role="status">{message("Загрузка маршрута {p0}…", {
        p0: route
      })}</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={onRetry}>{message("Повторить загрузку {p0}", {
          p0: route
        })}</button></div>}
    {selectedSegment && <section className="metric-card"><span>{t("Выбранный участок")}</span><strong>{selectedSegment.status === 'unknown' ? t("Нет расчёта") : t("{p0} км", {
          p0: number(selectedSegment.gap_km)
        })}</strong><small>{t(A9_STATUS[selectedSegment.status].label)}</small><p className="note">{t("Предварительная оценка интервала по дорожной модели.")}</p></section>}
    {summary && <>
      <p>{message("{p0} · расчётная длина направления", {
          p0: <strong>{message("{p0} км", {
              p0: number(summary.length_km)
            })}</strong>
        })}</p>
      {pilot.sections && <p className="note">{message("Сумма длин раздельных участков. {p0} Интервалы через разрыв не рассчитываются.", {
          p0: t(AUTOBAHNS[route].gapNote) || t("Между ними реальный разрыв в Эйфеле.")
        })}</p>}
      <p className="note">{t("Доступность по дорожной модели · OSM · 3 км / 3 км / 60 м")}</p>
      <section className="a9-summary-block" aria-label={t("Площадки с найденным маршрутом")}>
        <h3>{t("Площадки с найденным маршрутом")}</h3>
        <p>{message("{p0} {p1} с найденными подъездом и возвратом{p2}", {
            p0: <strong>{number(summary.routed)}</strong>,
            p1: siteWord(summary.routed),
            p2: pilot.accessNetwork ? t(", из них:") : '.'
          })}</p>
        {pilot.accessNetwork && <ul className="a9-summary-list">
          <li>{message("{p0} {p1} с DC-точкой ≥150 кВт;", {
              p0: <strong>{number(summary.fast_routed)}</strong>,
              p1: siteWord(summary.fast_routed)
            })}</li>
          <li>{message("{p0} {p1} с суммарной мощностью ≥400 кВт и хотя бы одной DC-точкой ≥150 кВт.", {
              p0: <strong>{number(summary.eligible_routed)}</strong>,
              p1: siteWord(summary.eligible_routed)
            })}</li>
        </ul>}
      </section>
      <section className="power-distribution a9-site-legend" aria-label={t("Обозначения площадок · легенда")}>
        <h3><button type="button" className="distribution-toggle" aria-expanded={legendOpen} aria-controls={legendId} onClick={() => setLegendOpen(open => !open)}><span>{t("Обозначения площадок · легенда")}</span><span aria-hidden="true">{legendOpen ? '−' : '+'}</span></button></h3>
        <div id={legendId} hidden={!legendOpen}>
        <p className="note">{t("Цвет — максимум мощности одной точки на площадке.")}</p>
        <div className="power-bands">{POWER_LABELS.map((label, index) => <div key={label}><i style={{
                background: palette.power[index]
              }} aria-hidden="true" />{t(label)}</div>)}</div>
        <div className="a9-key a9-shape-key"><div>{message("{p0}Круг — отдельные условия доступа не отмечены", {
                p0: <i className="a9-point" aria-hidden="true" />
              })}</div><div>{message("{p0}Квадрат — отмечены условия доступа, см. карточку", {
                p0: <i className="a9-point a9-point-access" aria-hidden="true" />
              })}</div><div>{message("{p0}Обводка — участвует в расчёте интервалов", {
                p0: <i className="a9-point a9-point-eligible" aria-hidden="true" />
              })}</div></div>
        <p className="note">{t("Цвет не подтверждает дорожную связь. Отсутствие отмеченных условий не гарантирует свободный доступ.")}</p>
      <section aria-label={t("Отдельные условия доступа")}>
        <p className="note">{message("У {p0} {p1} с найденным маршрутом отмечены отдельные условия доступа. На карте они обозначены квадратами; подробности — в карточке площадки. Эти признаки сами по себе не исключают площадку из интервалов.", {
                p0: number(accessConditionSites.length),
                p1: countWord(accessConditionSites.length, ['площадки', 'площадок', 'площадок'], language)
              })}</p>
      </section>
        </div>
      </section>
      <section className="a9-review-block" aria-label={t("Площадки, требующие проверки")}>
        <p>{message("{p0} {p1} {p2} проверки.", {
            p0: <strong>{number(reviewSites.length)}</strong>,
            p1: siteWord(reviewSites.length),
            p2: (language === 'de' ? reviewSites.length === 1 : reviewSites.length % 10 === 1 && reviewSites.length % 100 !== 11) ? t("требует") : t("требуют")
          })}</p>
        <Switch checked={showUnrouted} onChange={onShowUnrouted} className="a9-candidate-toggle">{t("Показать площадки, требующие проверки")}</Switch>
        <p className="note">{t("Здесь проверяется дорожная связь. Фактические въезды отдельно не подтверждены и у площадок с найденным маршрутом.")}</p>
      </section>
      {summary.max_gap_km != null && <p className="a9-gap-summary">{message("Максимальный расчётный интервал: {p0}.", {
          p0: <strong>{message("{p0} км", {
              p0: number(summary.max_gap_km)
            })}</strong>
        })}</p>}
      <div className="a9-key">{Object.entries(A9_STATUS).map(([key, s]) => <div key={key}><i className={`a9-line a9-${key}`} />{t(s.label)}</div>)}</div>
      <section className="power-distribution a9-method" aria-label={t("Методика и пояснения")}>
        <h3><button type="button" className="distribution-toggle" aria-expanded={methodOpen} aria-controls={methodId} onClick={() => setMethodOpen(open => !open)}><span>{t("Методика и пояснения")}</span><span aria-hidden="true">{methodOpen ? '−' : '+'}</span></button></h3>
        <div id={methodId} hidden={!methodOpen}>
          {excluded > 0 && !pilot.diagnostic && <p className="note">{message("{p0} {p1} {p2} по длине подъезда в модели OSM. Они не показываются и не участвуют в интервалах.", {
              p0: number(excluded),
              p1: siteWord(excluded),
              p2: (language === 'de' ? excluded === 1 : excluded % 10 === 1 && excluded % 100 !== 11) ? t("исключена") : t("исключены")
            })}</p>}
          {pilot.accessNetwork && <div className="a9-count-explanation">
            <p className="note">{t("Площадки с DC-точкой ≥150 кВт входят в указанные выше группы:")}</p>
            <ul className="a9-method-list note">
              <li>{message("С найденным маршрутом: {p0}, из них {p1} с DC-точкой ≥150 кВт. Остальные {p2} не имеют DC-точки такой мощности.", {
                  p0: number(summary.routed),
                  p1: number(summary.fast_routed),
                  p2: number(summary.routed - summary.fast_routed)
                })}</li>
              <li>{message("Требуют проверки: {p0}, из них {p1} с DC-точкой ≥150 кВт. Остальные {p2} не имеют DC-точки такой мощности.", {
                  p0: number(reviewSites.length),
                  p1: number(reviewFast),
                  p2: number(reviewSites.length - reviewFast)
                })}</li>
            </ul>
            <p className="note">{message("Всего площадок с DC-точкой ≥150 кВт среди этих двух групп: {p0} = {p1} + {p2}. Площадки, требующие проверки, не участвуют в расчёте интервалов.", {
                p0: number(fastTotal),
                p1: number(summary.fast_routed),
                p2: number(reviewFast)
              })}</p>
          </div>}
          {pilot.sections && <>
            <p className="note">{message("Длина {p0} — сумма длин раздельных участков направления. Интервалы считаются внутри каждого участка; через разрыв линия не проводится.", {
                p0: route
              })}</p>
            <ul className="a9-method-list note">{pilot.sections.filter(s => s.direction === direction).map(s => <li key={s.section}>{message("{p0}: {p1} км · максимальный расчётный интервал {p2}.", {
                  p0: AUTOBAHNS[route].sectionLabels?.[s.section] || (s.section === 'northern' ? 'Heiligenhafen — Blankenheim' : 'Kelberg — Saarbrücken'),
                  p1: number(s.length_km),
                  p2: s.max_gap_km == null ? '—' : t('{p0} км', {
                    p0: number(s.max_gap_km)
                  })
                })}</li>)}</ul>
          </>}
          {exitZones && <p className="note">{message("Оба направления проверены отдельно от всех разрешённых ответвлений, включая площадки отдыха. В подъездной сети учитываются другие автобаны. Развязки помогают разбирать участки; отбор идёт по дорожному пути, а не по расстоянию вдоль {p0}. Длинные подъезды исключены по диагностической сети OSM; это не заключение об отсутствии короткого пути на местности. Диагностическое снятие ограничений не подтверждает доступ.", {
              p0: route
            })}</p>}
          {pilot.candidateCorridorM != null && <p className="note">{message("Кандидаты отобраны в пределах {p0} км от геометрии трассы. Это область поиска кандидатов, а не условие доступности. {p1}", {
              p0: number(pilot.candidateCorridorM / 1000),
              p1: pilot.diagnostic ? t("Очередь проверки уточнена диагностикой сохранённой дорожной сети. Ослабленные диагностические ограничения не подтверждают доступ. Найденные маршруты и интервалы сохранены.") : t("Площадки без найденной связи остаются в проверке; диагностическое исключение по длинному подъезду в этих данных не выполнялось.")
            })}</p>}
          <p className="note">{t("Площадки с найденным маршрутом показаны сразу; цвет обозначает мощность точки. Площадки, требующие проверки, включаются переключателем в правой панели. Реальные въезды требуют проверки. Группировка временно отключена.")}</p>
          <p className="note">{t("Обводка выделяет площадки с найденным маршрутом, номинальной мощностью установок ≥400 кВт и DC-точкой ≥150 кВт. Цвет показывает мощность одной точки и сам по себе не означает выполнение этих условий.")}</p>
          <p className="note">{pilot.accessNetwork ? t("Маршруты по OSM учитывают одностороннее движение, запреты поворотов и ограничения доступа. Подъезд ≤3 км, возврат на своё направление ≤3 км; привязка к ближайшей дороге ≤60 м. Это доступность по дорожной модели, а не подтверждение фактического въезда.") : t("Подъездная сеть ещё не проверена. Близость к автобану не подтверждает доступность с выбранного направления.")}</p>
          <p className="note">{t("Шлагбаум, доступ для клиентов или разрешение владельца территории показываются отдельно. Неизвестные фактические условия не считаются автоматически запретом. Соседние зарядки OSM — дополнительные сведения: они не добавляют площадку в интервалы, а отклонённое сопоставление не отменяет её собственный маршрут.")}</p>
          <p className="note">{message("Срез зарядок: {p0}. Это исследовательская оценка, не заключение о соответствии AFIR. Порог 50 км — наше предупреждение.", {
              p0: pilot.sourceDate
            })}</p>
          <p className="note">{t("Базовые показатели относятся к полному исходному набору. Фильтры карты меняют только показ площадок.")}</p>
          <p className="note">{t("Интервал включает возврат предыдущей площадки, участок автобана и подъезд следующей. При несовместимых съезде и возврате интервал не рассчитан. Цветные интервалы рассчитаны между площадками с найденным маршрутом, ≥400 кВт и DC-точкой ≥150 кВт. Это не подтверждение доступности зарядки или соответствия AFIR. Цвет точек показывает мощность; найденный маршрут не подтверждает фактический въезд. Обводка выделяет площадки, участвующие в расчёте интервалов. Переключатель меняет только показ точек, интервалы не пересчитываются.")}</p>
        </div>
      </section>
    </>}
  </aside>;
}
