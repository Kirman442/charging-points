// Presentation colors stay separate from numeric worker data.
export const MAP_PALETTES = {
  dark: {
    power: ['#45c1b0', '#68b2f5', '#e9bd55', '#f08a70'],
    cluster: '#36515d', clusterText: '#f2f6f7', casing: '#10181e', outline: '#d9e7ed', selected: '#52c7b6',
    territoryHover: '#a1adb3', territorySelected: '#b2bcc1', boundary: [146,170,183,90], missing: '#9aa8b2',
    sequential: ['#2c254f', '#493c8a', '#795abf', '#b091e8', '#e6d5fa'],
    concentration: ['#657f99', '#e9a45d'],
    route: { within: '#44beaa', near: '#f0c246', gap: '#e8687e', unknown: '#96a2b3' },
  },
  light: {
    power: ['#087f72', '#246eb9', '#a76a08', '#bd5139'],
    cluster: '#d9e5eb', clusterText: '#182b34', casing: '#ffffff', outline: '#182b34', selected: '#146b61',
    territoryHover: '#77838a', territorySelected: '#66747c', boundary: [82,103,117,110], missing: '#667680',
    sequential: ['#f0ebf7', '#d4c2e7', '#ad90d2', '#7845b0', '#4b1e80'],
    concentration: ['#6a8299', '#b96624'],
    route: { within: '#087f72', near: '#986308', gap: '#b33d58', unknown: '#667680' },
  },
}
export const paletteFor = style => MAP_PALETTES[style] || MAP_PALETTES.dark
export const rgba = (hex, alpha = 255) => [1,3,5].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(alpha)
export const powerIndex = value => value >= 150 ? 3 : value >= 50 ? 2 : value > 22 ? 1 : 0
export function sequentialColor(value, maximum, style) {
  const colors = paletteFor(style).sequential
  const t = Math.max(0, Math.min(1, value / Math.max(1, maximum))) * (colors.length - 1)
  const lo = Math.min(colors.length - 2, Math.floor(t)), mix = t - lo
  const a = rgba(colors[lo]), b = rgba(colors[lo + 1])
  return a.map((v, i) => i === 3 ? 220 : Math.round(v + (b[i] - v) * mix))
}
export function displayColors(data, options, clustered = false) {
  const palette = paletteFor(options.style)
  const colors = new Uint8Array(data.count * 4)
  for (let i = 0; i < data.count; i++) {
    let color
    if (clustered && data.siteCounts[i] > 1) color = rgba(palette.cluster)
    else if (options.a9Mode) {
      const alpha = data.colors[i * 4 + 3]
      color = options.style !== 'light' ? Array.from(data.colors.subarray(i * 4, i * 4 + 4))
        : rgba(alpha === 255 ? palette.route.within : palette.missing, alpha)
    } else color = rgba(palette.power[powerIndex(data.powers[i])])
    colors.set(color, i * 4)
  }
  return colors
}
// Explicit capped domains allow comparison after filter changes.
export const FIXED_DOMAINS = { bev: 600000, ratio: 500, power: 25000, concentration: 100 }
