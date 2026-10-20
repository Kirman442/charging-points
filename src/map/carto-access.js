// Basemaps keys are public client keys, never CARTO platform/admin credentials.
// Restrict propagation to CARTO's HTTPS basemap infrastructure.
export function cartoRequest(url, key) {
  if (!key?.trim()) return { url }
  try {
    const target = new URL(url)
    const host = target.hostname
    if (target.protocol !== 'https:' || !(host === 'basemaps.cartocdn.com' || host.endsWith('.basemaps.cartocdn.com'))) return { url }
    target.searchParams.set('key', key.trim())
    return { url: target.href }
  } catch {
    return { url }
  }
}
