export function legalPageFromHash(hash) {
  return hash === '#datenschutz' ? 'datenschutz' : hash === '#impressum' ? 'impressum' : null
}

export function legalLinkTarget(href, baseUrl) {
  if (!href || href.startsWith('#')) return null
  try {
    const base = new URL(baseUrl), target = new URL(href, base)
    if (target.origin !== base.origin) return null
    if (target.pathname === base.pathname) return 'map'
    for (const page of ['datenschutz', 'impressum']) {
      if (target.pathname === `${base.pathname}${page}.html`) return page
    }
  } catch { /* Ordinary browser navigation handles other links. */ }
  return null
}
