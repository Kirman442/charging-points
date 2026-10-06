// Audit snapshot from step24 commit f8da0fa; diagnostic use only.
// Numeric joins are prepared offline. Original string-ID cohorts remain an audit source.
export async function fingerprint(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
}
const mismatch = () => new Error('Числовые индексы не соответствуют данным площадок. Пересоздай их: python scripts/prepare_runtime_point_groups.py')
function dictionary(metadata, key) {
  const values = JSON.parse(metadata.get(key) || 'null')
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value) || new Set(values).size !== values.length) throw mismatch()
  return values
}
function column(table, name, Type) {
  const values = table.getChild(name)?.toArray()
  if (!(values instanceof Type) || values.length !== table.numRows || table.getChild(name).nullCount) throw mismatch()
  return values
}
export function readRuntimeIndexes(sites, numeric, catalog, hashes) {
  const metadata = catalog.schema.metadata
  for (const table of [numeric, catalog]) {
    if (table.schema.metadata.get('runtime_format') !== 'point-groups-v1' ||
      table.schema.metadata.get('sites_sha256') !== hashes.sites ||
      Number(table.schema.metadata.get('site_count')) !== sites.numRows) throw mismatch()
  }
  if (metadata.get('numeric_groups_sha256') !== hashes.groups) throw mismatch()
  const equipmentCount = Number(metadata.get('equipment_count'))
  if (!Number.isInteger(equipmentCount) || equipmentCount <= 0 || equipmentCount > numeric.numRows ||
      equipmentCount !== Number(numeric.schema.metadata.get('equipment_count'))) throw mismatch()
  const codes = dictionary(metadata, 'district_codes'), stateNames = dictionary(metadata, 'state_names')
  const names = Array.from(catalog.getChild('operator_name') || [])
  if (!names.length || names.some(name => typeof name !== 'string' || !name)) throw mismatch()
  const groups = {
    rows: column(numeric, 'site_row', Uint32Array), equipment: column(numeric, 'equipment_index', Uint32Array),
    districts: column(numeric, 'district_index', Uint16Array), codes,
    powers: column(numeric, 'max_power_kw', Float64Array), nominal: column(numeric, 'equipment_power_kw', Float64Array),
    counts: column(numeric, 'point_count', Uint32Array), dc: column(numeric, 'has_dc', Uint8Array), equipmentCount,
    siteStates: new Uint8Array(sites.numRows), stateNames, alwaysOpen: new Uint8Array(sites.numRows),
  }
  const state = column(numeric, 'state_index', Uint8Array), operator = column(numeric, 'operator_index', Uint32Array)
  const hours = column(numeric, 'site_always_open', Uint8Array), ids = new Uint32Array(sites.numRows)
  const seenSites = new Uint8Array(sites.numRows), seenEquipment = new Uint8Array(equipmentCount)
  let siteCount = 0, eqCount = 0
  for (let i = 0; i < numeric.numRows; i++) {
    const row = groups.rows[i], eid = groups.equipment[i]
    if (row >= sites.numRows || eid >= equipmentCount || groups.districts[i] >= codes.length ||
      state[i] >= stateNames.length || operator[i] >= names.length || hours[i] > 1 || groups.dc[i] > 1 ||
      !groups.counts[i] || !Number.isFinite(groups.powers[i]) || groups.powers[i] < 0 ||
      !Number.isFinite(groups.nominal[i]) || groups.nominal[i] < 0) throw mismatch()
    if (seenSites[row]) {
      if (ids[row] !== operator[i] || groups.siteStates[row] !== state[i] || groups.alwaysOpen[row] !== hours[i]) throw mismatch()
    } else {
      seenSites[row] = 1; siteCount++
      ids[row] = operator[i]; groups.siteStates[row] = state[i]; groups.alwaysOpen[row] = hours[i]
    }
    if (!seenEquipment[eid]) { seenEquipment[eid] = 1; eqCount++ }
  }
  if (siteCount !== sites.numRows || eqCount !== equipmentCount) throw mismatch()
  return { pointGroups: groups, operatorIndex: { ids, names } }
}
