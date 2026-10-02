const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
export const format = value => value === null || value === undefined ? '—' : number.format(value)
