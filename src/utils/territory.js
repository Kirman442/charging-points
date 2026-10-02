export function territoryLabel(type) {
  if (type === 'Kreisfreie Stadt' || type === 'Stadtkreis') return `Город вне состава района · ${type}`
  if (type === 'Landkreis' || type === 'Kreis') return `Район · ${type}`
  return type || ''
}
