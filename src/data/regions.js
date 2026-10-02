import { parseSync } from '@loaders.gl/core'
import { WKBLoader } from '@loaders.gl/wkt'

export function decodeRegions(table, level) {
  const fields = table.schema.fields.map(field => field.name).filter(name => name !== 'geometry')
  return Array.from({ length: table.numRows }, (_, index) => {
    const properties = Object.fromEntries(fields.map(name => {
      const value = table.getChild(name).get(index)
      return [name, typeof value === 'bigint' ? Number(value) : value]
    }))
    const bytes = table.getChild('geometry').get(index)
    const geometry = parseSync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), WKBLoader)
    return { type: 'Feature', geometry, properties: { ...properties, level } }
  })
}

export function aggregateStates(table) {
  const states = table.getChild('state_name')
  const points = table.getChild('charging_point_count')
  const totals = {}
  for (let i = 0; i < table.numRows; i++) {
    const state = states.get(i)
    totals[state] ||= { sites: 0, points: 0 }
    totals[state].sites++
    totals[state].points += points.get(i)
  }
  return totals
}

export function enrichStates(features, totals) {
  return features.map(feature => {
    const stats = totals[feature.properties.state_name]
    if (!stats) throw new Error(`Не сопоставлена земля ${feature.properties.state_name}`)
    const bev = feature.properties.bev_count
    return { ...feature, properties: { ...feature.properties, ...stats, points_per_1000_bev: bev > 0 ? stats.points / bev * 1000 : null } }
  })
}
