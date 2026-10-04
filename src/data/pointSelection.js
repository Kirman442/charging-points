import { matchingIndices } from './prepareSites.js'
import { addOperator, summarizeOperators } from './operators.js'

export const POWER_BANDS = [
  { label: '≤22 кВт', color: '#40b8ad' },
  { label: '>22–<50 кВт', color: '#54a1e5' },
  { label: '50–<150 кВт', color: '#f0c55b' },
  { label: '≥150 кВт', color: '#f47a61' },
]
export function powerBand(power) { return power >= 150 ? 3 : power >= 50 ? 2 : power > 22 ? 1 : 0 }
export function buildPointGroups(sites, table) {
  const rowById = new Map(Array.from(sites.getChild('site_id'), (id, row) => [id, row]))
  const equipmentIds = new Map(), districtIds = new Map(), codes = []
  const names = ['site_id','equipment_id','district_code','max_power_kw','has_dc','point_count','equipment_power_kw']
  const c = Object.fromEntries(names.map(name => [name, table.getChild(name)]))
  const n = table.numRows
  const rows = new Uint32Array(n), equipment = new Uint32Array(n), districts = new Uint16Array(n)
  const powers = new Float64Array(n), nominal = new Float64Array(n), counts = new Uint32Array(n), dc = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const row = rowById.get(c.site_id.get(i)), eid = c.equipment_id.get(i), code = c.district_code.get(i)
    if (row === undefined) throw new Error('Point groups do not match site IDs')
    if (!equipmentIds.has(eid)) equipmentIds.set(eid, equipmentIds.size)
    if (!districtIds.has(code)) { districtIds.set(code, codes.length); codes.push(code) }
    rows[i] = row; equipment[i] = equipmentIds.get(eid); districts[i] = districtIds.get(code)
    powers[i] = c.max_power_kw.get(i); nominal[i] = c.equipment_power_kw.get(i); counts[i] = c.point_count.get(i); dc[i] = Number(c.has_dc.get(i))
    if (!Number.isFinite(powers[i]) || powers[i] < 0 || !Number.isFinite(nominal[i]) || nominal[i] < 0 || counts[i] <= 0) throw new Error('Invalid point cohort')
  }
  return { rows, equipment, districts, codes, powers, nominal, counts, dc, equipmentCount: equipmentIds.size }
}
const empty = () => ({ sites: 0, points: 0, equipment: 0, installed_power_kw: 0, powerBands: [0,0,0,0] })
export function selectPoints(table, groups, filters, operatorIndex) {
  // State and whole-site 24/7 remain site conditions; power/DC must match the same point.
  const allowed = new Uint8Array(table.numRows)
  for (const row of matchingIndices(table, { state: filters.state, alwaysOpen: filters.alwaysOpen })) allowed[row] = 1
  const points = new Uint32Array(table.numRows), equipmentCounts = new Uint32Array(table.numRows)
  const nominal = new Float64Array(table.numRows), maxPowers = new Float32Array(table.numRows)
  const seenEquipment = new Uint8Array(groups.equipmentCount)
  const states = {}, districts = {}, stateOps = new Map(), districtOps = new Map(), nationalOps = new Map()
  const districtSites = new Map(), stateColumn = table.getChild('state_name')
  const add = (ops, key, id, count, power) => { if (!ops.has(key)) ops.set(key, new Map()); addOperator(ops.get(key), id, count, power) }
  for (let i = 0; i < groups.rows.length; i++) {
    const row = groups.rows[i]
    if (!allowed[row] || groups.powers[i] < Number(filters.minPower || 0) || (filters.dcOnly && !groups.dc[i])) continue
    const eid = groups.equipment[i], count = groups.counts[i], code = groups.codes[groups.districts[i]]
    const first = !seenEquipment[eid], power = first ? groups.nominal[i] : 0, eqCount = Number(first)
    seenEquipment[eid] = 1
    const name = stateColumn.get(row), op = operatorIndex.ids[row], band = powerBand(groups.powers[i])
    states[name] ||= empty(); districts[code] ||= empty()
    if (!points[row]) states[name].sites++
    if (!districtSites.has(code)) districtSites.set(code, new Set())
    if (!districtSites.get(code).has(row)) { districtSites.get(code).add(row); districts[code].sites++ }
    points[row] += count; nominal[row] += power; equipmentCounts[row] += eqCount
    maxPowers[row] = Math.max(maxPowers[row], groups.powers[i])
    for (const total of [states[name], districts[code]]) { total.points += count; total.equipment += eqCount; total.installed_power_kw += power; total.powerBands[band] += count }
    add(stateOps, name, op, count, power); add(districtOps, code, op, count, power); addOperator(nationalOps, op, count, power)
  }
  for (const [name, total] of Object.entries(states)) total.operators = summarizeOperators(stateOps.get(name), operatorIndex.names)
  for (const [code, total] of Object.entries(districts)) total.operators = summarizeOperators(districtOps.get(code), operatorIndex.names)
  const indices = Array.from({ length: table.numRows }, (_, row) => row).filter(row => points[row] > 0)
  return { indices, points, nominal, equipmentCounts, maxPowers, stats: { states, districts, nationalOperators: summarizeOperators(nationalOps, operatorIndex.names) } }
}
