import { useI18n } from "../i18n/useI18n.js";
import { accessConditionLabels, otherRoadConditionLabels } from '../data/autobahnAccess.js';
import { motorwayReviewLabel } from '../data/motorwayDiagnostics.js';
export default function AutobahnAccess({
  site
}) {
  const {
    language,
    t,
    message
  } = useI18n();
  if (!site) return null;
  const found = site.status === 'road_route_found_entrance_unverified';
  const conditions = accessConditionLabels(site.accessConditions, language);
  const otherConditions = otherRoadConditionLabels(site.accessConditions);
  return <section aria-label={t("Доступность по дорожной модели")}>
    <h3>{t("Доступность по дорожной модели")}</h3>
    <p>{found ? t("Подъезд и возврат найдены по OSM.") : site.status === 'distance_excluded' ? t("Подъезд превышает предел модели.") : t("Подходящий подъезд и возврат в модели не установлены.")}</p>
    {!found && site.status === 'unconfirmed' && motorwayReviewLabel(site.review_reason) && <p className="note">{message("Причина проверки: {p0}", {
        p0: t(motorwayReviewLabel(site.review_reason))
      })}</p>}
    {found && <p className="note">{message("Подъезд: {p0} км · возврат: {p1} км · привязка: {p2} м.", {
        p0: (site.access_m / 1000).toLocaleString(language === 'de' ? 'de-DE' : 'ru-RU'),
        p1: (site.return_m / 1000).toLocaleString(language === 'de' ? 'de-DE' : 'ru-RU'),
        p2: site.snap_m.toLocaleString(language === 'de' ? 'de-DE' : 'ru-RU')
      })}</p>}
    <h4>{t("Условия доступа на найденном пути")}</h4>
    {conditions.length ? <><ul className="note">{conditions.map(label => <li key={label}>{label}</li>)}</ul><p className="note">{t("Эти сведения требуют пояснения и сами по себе не отменяют найденный маршрут.")}</p></> : <p className="note">{site.accessEvidenceChecked ? t("В сохранённых данных найденного пути отдельные условия не отмечены.") : t("Отдельных проверенных сведений об условиях пути нет.")}</p>}
    {otherConditions.length > 0 && <details><summary>{t("Прочие дорожные сведения")}</summary><ul className="note">{otherConditions.map(label => <li key={label}>{label}</li>)}</ul><p className="note">{t("Эти теги не определяют обозначение условий доступа на карте.")}</p></details>}
    <p className="note">{message("Источник: {p0}. Условия относятся к подъезду и/или возврату; часы доступа на пути не означают часы работы зарядки.", {
        p0: site.accessEvidenceSourceKey === 'osm-route' ? t('osm-route-source', {
          route: site.accessEvidenceRoute
        }) : t('сохранённые данные OSM из расчёта шага 35')
      })}</p>
    <p className="note">{t("Фактический въезд, последние метры и текущие условия работы зарядки не подтверждены. Сведения соседних зарядок OSM не заменяют собственный маршрут площадки.")}</p>
  </section>;
}
