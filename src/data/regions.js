import { addOperator, buildOperatorIndex, summarizeOperators } from './operators.js'
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
    totals[state] ||= { sites: 0, points: 0, installed_power_kw: 0, equipment: 0 }
    totals[state].sites++
    totals[state].points += points.get(i)
    totals[state].installed_power_kw += table.getChild("installed_power_kw").get(i)
    totals[state].equipment += table.getChild("equipment_count").get(i)
  }
  return totals
}

export function enrichStates(features, totals) {
  return features.map(feature => {
    const stats = totals[feature.properties.state_name]
    if (!stats) throw new Error(`Не сопоставлена земля ${feature.properties.state_name}`)
    const bev = feature.properties.bev_count
    return { ...feature, properties: { ...feature.properties, ...stats, kw_per_1000_bev: bev > 0 ? stats.installed_power_kw / bev * 1000 : null, points_per_1000_bev: bev > 0 ? stats.points / bev * 1000 : null } }
  })
}

export function buildDistrictIndex(table, indexTable) {
  const rowById = new Map(Array.from(table.getChild('site_id'), (id, row) => [id, row]))
  const links = []
  for (let i = 0; i < indexTable.numRows; i++) {
    const row = rowById.get(indexTable.getChild('site_id').get(i))
    if (row === undefined) throw new Error('District index does not match site IDs')
    links.push({ row, code: indexTable.getChild('district_code').get(i), points: indexTable.getChild('charging_point_count').get(i), power: indexTable.getChild('installed_power_kw').get(i), equipment: indexTable.getChild('equipment_count').get(i) })
  }
  return links
}
export function aggregateSelection(table, indices, links = [], operatorIndex = buildOperatorIndex(table)) {
  const states = {}, districts = {}
  const nationalOperators = new Map(), stateOperators = new Map(), districtOperators = new Map()
  const add = (groups, key, id, points, power) => {
    if (!groups.has(key)) groups.set(key, new Map())
    addOperator(groups.get(key), id, points, power)
  }
  const mask = new Uint8Array(table.numRows)
  const stateColumn = table.getChild('state_name'), pointColumn = table.getChild('charging_point_count')
  const powerColumn = table.getChild('installed_power_kw'), equipmentColumn = table.getChild('equipment_count')
  for (const row of indices) {
    mask[row] = 1
    const name = stateColumn.get(row)
    const points = pointColumn.get(row), power = powerColumn.get(row)
    states[name] ||= { sites: 0, points: 0, installed_power_kw: 0, equipment: 0 }
    states[name].sites++
    states[name].points += points
    states[name].installed_power_kw += power
    states[name].equipment += equipmentColumn.get(row)
    addOperator(nationalOperators, operatorIndex.ids[row], points, power)
    add(stateOperators, name, operatorIndex.ids[row], points, power)
  }
  for (const link of links) if (mask[link.row]) {
    districts[link.code] ||= { sites: 0, points: 0, installed_power_kw: 0, equipment: 0 }
    districts[link.code].sites++
    districts[link.code].points += link.points
    districts[link.code].installed_power_kw += link.power
    districts[link.code].equipment += link.equipment
    add(districtOperators, link.code, operatorIndex.ids[link.row], link.points, link.power)
  }
  for (const [name, counts] of Object.entries(states)) counts.operators = summarizeOperators(stateOperators.get(name), operatorIndex.names)
  for (const [code, counts] of Object.entries(districts)) counts.operators = summarizeOperators(districtOperators.get(code), operatorIndex.names)
  return { states, districts, nationalOperators: summarizeOperators(nationalOperators, operatorIndex.names) }
}
export function applyRegionStats(regions, stats) {
  const enrich = (features, level) => features.map(feature => {
    const p = feature.properties
    const key = level === 'states' ? p.state_name : p.district_code
    const count = stats[level][key] || { sites: 0, points: 0, installed_power_kw: 0, equipment: 0, operators: summarizeOperators(new Map(), []) }
    return { ...feature, properties: { ...p, ...count, kw_per_1000_bev: p.bev_count > 0 ? count.installed_power_kw / p.bev_count * 1000 : null, points_per_1000_bev: p.bev_count > 0 ? count.points / p.bev_count * 1000 : null } }
  })
  return { states: enrich(regions.states, 'states'), districts: enrich(regions.districts, 'districts') }
}
