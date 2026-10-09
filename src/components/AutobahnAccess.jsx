import { accessConditionLabels } from '../data/autobahnAccess.js'

export default function AutobahnAccess({ site }) {
  if (!site) return null
  const found = site.status === 'road_route_found_entrance_unverified'
  const conditions = accessConditionLabels(site.accessConditions)
  return <section aria-label="Доступность по дорожной модели">
    <h3>Доступность по дорожной модели</h3>
    <p>{found ? 'Подъезд и возврат найдены по OSM.' : site.status === 'distance_excluded' ? 'Подъезд превышает предел модели.' : 'Подходящий подъезд и возврат в модели не установлены.'}</p>
    {found && <p className="note">Подъезд: {(site.access_m / 1000).toLocaleString('ru-RU')} км · возврат: {(site.return_m / 1000).toLocaleString('ru-RU')} км · привязка: {site.snap_m.toLocaleString('ru-RU')} м.</p>}
    <h4>Условия доступа на найденном пути</h4>
    {conditions.length ? <><ul className="note">{conditions.map(label => <li key={label}>{label}</li>)}</ul><p className="note">Эти сведения требуют пояснения и сами по себе не отменяют найденный маршрут.</p></> : <p className="note">{site.accessEvidenceChecked ? 'В сохранённых данных найденного пути отдельные условия не отмечены.' : 'Отдельных проверенных сведений об условиях пути нет.'}</p>}
    <p className="note">Фактический въезд, последние метры и текущие условия работы зарядки не подтверждены. Сведения соседних зарядок OSM не заменяют собственный маршрут площадки.</p>
  </section>
}
