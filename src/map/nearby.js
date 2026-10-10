export function nearbySites(data, center, limit = 20) {
  if (!data || !center || limit <= 0) return []
  const rad = Math.PI / 180, lat = center.latitude * rad
  const nearest = []
  for (let i = 0; i < data.count; i++) {
    // Invisible out-of-corridor sites are not results in motorway mode.
    if (data.colors[i * 4 + 3] < 30) continue
    const longitude = data.positions[i * 2], latitude = data.positions[i * 2 + 1]
    const dLat = (latitude - center.latitude) * rad, dLon = (longitude - center.longitude) * rad
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat) * Math.cos(latitude * rad) * Math.sin(dLon / 2) ** 2
    const distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
    if (nearest.length === limit && distance >= nearest.at(-1).distance) continue
    const item = { rowIndex: data.rowIndices[i], power: data.powers[i], points: data.pointCounts[i], longitude, latitude, distance }
    const position = nearest.findIndex(entry => entry.distance > distance)
    nearest.splice(position < 0 ? nearest.length : position, 0, item)
    if (nearest.length > limit) nearest.pop()
  }
  return nearest
}
