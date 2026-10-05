// Compare selection values, not object identity. Display settings are excluded.
export function filterKey(filters = {}) {
  return JSON.stringify([filters.state || '', Number(filters.minPower || 0), Boolean(filters.dcOnly), Boolean(filters.alwaysOpen)])
}
