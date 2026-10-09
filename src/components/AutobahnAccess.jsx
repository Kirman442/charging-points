import { accessConditionLabels, otherRoadConditionLabels } from '../data/autobahnAccess.js'

export default function AutobahnAccess({ site }) {
  if (!site) return null
  const found = site.status === 'road_route_found_entrance_unverified'
  const conditions = accessConditionLabels(site.accessConditions)
  const otherConditions = otherRoadConditionLabels(site.accessConditions)
  return <section aria-label="Доступность по дорожной модели">
    <h3>Доступность по дорожной модели</h3>
    <p>{found ? 'Подъезд и возврат найдены по OSM.' : site.status === 'distance_excluded' ? 'Подъезд превышает предел модели.' : 'Подходящий подъезд и возврат в модели не установлены.'}</p>
    {found && <p className="note">Подъезд: {(site.access_m / 1000).toLocaleString('ru-RU')} км · возврат: {(site.return_m / 1000).toLocaleString('ru-RU')} км · привязка: {site.snap_m.toLocaleString('ru-RU')} м.</p>}
    <h4>Условия доступа на найденном пути</h4>
    {conditions.length ? <><ul className="note">{conditions.map(label => <li key={label}>{label}</li>)}</ul><p className="note">Эти сведения требуют пояснения и сами по себе не отменяют найденный маршрут.</p></> : <p className="note">{site.accessEvidenceChecked ? 'В сохранённых данных найденного пути отдельные условия не отмечены.' : 'Отдельных проверенных сведений об условиях пути нет.'}</p>}
    {otherConditions.length > 0 && <details><summary>Прочие дорожные сведения</summary><ul className="note">{otherConditions.map(label => <li key={label}>{label}</li>)}</ul><p className="note">Эти теги не определяют обозначение условий доступа на карте.</p></details>}
    <p className="note">Источник: сохранённые данные OSM из расчёта шага 35. Условия относятся к подъезду и/или возврату; часы доступа на пути не означают часы работы зарядки.</p>
    <p className="note">Фактический въезд, последние метры и текущие условия работы зарядки не подтверждены. Сведения соседних зарядок OSM не заменяют собственный маршрут площадки.</p>
  </section>
}
