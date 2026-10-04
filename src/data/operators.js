const nameOrder = new Intl.Collator('de')

// Technical name cleanup only: never infer corporate ownership or merge legal entities.
export function buildOperatorIndex(table) {
  const names = [], byKey = new Map(), ids = new Uint32Array(table.numRows)
  const column = table.getChild('operator')
  for (let row = 0; row < table.numRows; row++) {
    const display = String(column.get(row) || '').normalize('NFC').trim().replace(/\s+/gu, ' ') || 'Оператор не указан'
    const key = display.toLocaleLowerCase('de-DE')
    if (!byKey.has(key)) { byKey.set(key, names.length); names.push(display) }
    ids[row] = byKey.get(key)
  }
  return { ids, names }
}
export function addOperator(totals, id, points, power) {
  const current = totals.get(id) || { points: 0, power: 0 }
  current.points += points
  current.power += power
  totals.set(id, current)
}
export function summarizeOperators(totals, names, limit = 5) {
  const entries = Array.from(totals, ([id, values]) => ({ name: names[id], ...values }))
  const summarize = basis => {
    const total = entries.reduce((sum, entry) => sum + entry[basis], 0)
    const sorted = [...entries].sort((a, b) => b[basis] - a[basis] || nameOrder.compare(a.name, b.name))
    const leaders = sorted.slice(0, limit).map(entry => ({ name: entry.name, value: entry[basis], share: total > 0 ? entry[basis] / total * 100 : null }))
    const otherEntries = sorted.slice(limit)
    const otherValue = otherEntries.reduce((sum, entry) => sum + entry[basis], 0)
    return { total, leaders, others: { count: otherEntries.length, value: otherValue, share: total > 0 ? otherValue / total * 100 : null } }
  }
  return { count: entries.length, points: summarize('points'), power: summarize('power') }
}
