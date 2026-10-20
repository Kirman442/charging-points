import { useCallback, useEffect, useRef, useState } from 'react'
import { legalLinkTarget, legalPageFromHash } from './navigation.js'
import './legal.css'

const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
const titles = { datenschutz: 'Datenschutz', impressum: 'Impressum' }

export default function LegalShell({ children }) {
  const [page, setPage] = useState(() => legalPageFromHash(window.location.hash))
  const [mapStarted, setMapStarted] = useState(() => !legalPageFromHash(window.location.hash))
  const hasMapHistory = useRef(!page)
  const opener = useRef(null), mapTitle = useRef(document.title)

  const close = useCallback(() => {
    if (hasMapHistory.current && window.history.state?.chargingLegal) {
      window.history.back()
    } else {
      const url = new URL(window.location.href)
      url.hash = ''
      window.history.replaceState(null, '', url)
      hasMapHistory.current = true
      setMapStarted(true)
      setPage(null)
    }
  }, [])

  const open = useCallback(next => {
    if (!page) {
      opener.current = document.activeElement
      mapTitle.current = document.title
    }
    const url = new URL(window.location.href)
    url.hash = next
    window.history[page ? 'replaceState' : 'pushState']({ chargingLegal: true }, '', url)
    setPage(next)
  }, [page])

  const follow = useCallback(event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const anchor = event.target.closest?.('a[href]')
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
    const target = legalLinkTarget(anchor.getAttribute('href'), baseUrl)
    if (target === 'map' && page) { event.preventDefault(); close() }
    else if (target && target !== 'map') { event.preventDefault(); open(target) }
  }, [page, close, open])

  useEffect(() => {
    document.addEventListener('click', follow)
    return () => document.removeEventListener('click', follow)
  }, [follow])
  useEffect(() => {
    const navigate = () => {
      const next = legalPageFromHash(window.location.hash)
      setPage(next)
      if (!next) setMapStarted(true)
    }
    window.addEventListener('popstate', navigate)
    window.addEventListener('hashchange', navigate)
    return () => {
      window.removeEventListener('popstate', navigate)
      window.removeEventListener('hashchange', navigate)
    }
  }, [])
  useEffect(() => {
    document.title = page ? `${titles[page]} · Ladeinfrastruktur in Deutschland` : mapTitle.current
    if (!page) opener.current?.focus()
  }, [page])

  return <>
    <div className="application-view" inert={page ? true : undefined} aria-hidden={page ? true : undefined} style={{ visibility: page ? 'hidden' : 'visible' }}>
      {mapStarted && children}
    </div>
    {page && <section className="legal-view" aria-label={titles[page]}>
      <iframe key={page} src={`${baseUrl}${page}.html`} title={titles[page]} onLoad={event => {
        const frame = event.currentTarget, doc = frame.contentDocument
        const map = document.querySelector('.map-app')
        if (map) {
          doc.documentElement.dataset.theme = map.dataset.theme
          const theme = getComputedStyle(map)
          for (const name of ['--panel', '--surface', '--text', '--muted', '--border', '--accent', '--shadow', '--warning', '--warning-bg']) {
            doc.documentElement.style.setProperty(name, theme.getPropertyValue(name))
          }
          doc.documentElement.style.setProperty('--page-background', theme.backgroundColor)
          doc.documentElement.style.fontFamily = theme.fontFamily
        }
        doc.addEventListener('click', follow)
        doc.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close() } })
        for (const anchor of doc.querySelectorAll('a[href^="https:"]')) {
          if (new URL(anchor.href).origin !== window.location.origin) {
            anchor.target = '_blank'
            anchor.rel = 'noreferrer'
          }
        }
        doc.querySelector('main a')?.focus()
      }} />
    </section>}
  </>
}
