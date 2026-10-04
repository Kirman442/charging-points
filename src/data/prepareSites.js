export function powerColor(power) {
  return power >= 150 ? [244,122,97,255] : power >= 50 ? [240,197,91,255] : power > 22 ? [84,161,229,255] : [64,184,173,255]
}

export function matchingIndices(table, filters = {}) {
  const state = table.getChild('state_name'), power = table.getChild('max_power_kw')
  const dc = table.getChild('dc_point_count'), hours = table.getChild('opening_hours_type')
  const indices = []
  for (let i = 0; i < table.numRows; i++) {
    if (filters.state && state.get(i) !== filters.state) continue
    if (power.get(i) < Number(filters.minPower || 0)) continue
    if (filters.dcOnly && dc.get(i) <= 0) continue
    if (filters.alwaysOpen && hours.get(i) !== '24_7') continue
    indices.push(i)
  }
  return indices
}

export function prepareSites(table, indices = matchingIndices(table), selection = null) {
  const names = ['longitude', 'latitude', 'max_power_kw', 'charging_point_count']
  const columns = Object.fromEntries(names.map(name => {
    const column = table.getChild(name)
    if (!column) throw new Error(`Отсутствует колонка ${name}`)
    return [name, column]
  }))
  const count = indices.length
  const positions = new Float64Array(count * 2), colors = new Uint8Array(count * 4)
  const powers = new Float32Array(count), pointCounts = new Int32Array(count)
  const rowIndices = new Uint32Array(indices)
  let totalPoints = 0
  for (let i = 0; i < count; i++) {
    const row = indices[i]
    const lon = columns.longitude.get(row), lat = columns.latitude.get(row)
    const power = selection ? selection.maxPowers[row] : columns.max_power_kw.get(row), points = selection ? selection.points[row] : columns.charging_point_count.get(row)
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error(`Некорректные координаты: строка ${row}`)
    if (!Number.isFinite(power) || power < 0 || !Number.isInteger(points) || points < 0) throw new Error(`Некорректные данные: строка ${row}`)
    positions[i * 2] = lon; positions[i * 2 + 1] = lat
    powers[i] = power; pointCounts[i] = points; totalPoints += points
    colors.set(powerColor(power), i * 4)
  }
  return { count, positions, colors, powers, pointCounts, rowIndices, totalPoints, sourceDate: table.getChild('source_date')?.get(0) }
}
