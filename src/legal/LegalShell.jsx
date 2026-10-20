import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { legalLinkTarget, legalPageFromHash } from './navigation.js'
import './legal.css'

const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
const titles = { datenschutz: 'Datenschutz', impressum: 'Impressum' }

export default function LegalShell({ children }) {
  const [page, setPage] = useState(() => legalPageFromHash(window.location.hash))
  const [mapStarted, setMapStarted] = useState(() => !legalPageFromHash(window.location.hash))
  const hasMapHistory = useRef(!page)
  const opener = useRef(null), mapTitle = useRef(document.title)
  const frames = useRef({}), legalView = useRef(null), currentFollow = useRef(null)
  const [ready, setReady] = useState({})
  const [lastReadyPage, setLastReadyPage] = useState(null)
  const shownPage = page && (ready[page] ? page : lastReadyPage)

  const syncTheme = useCallback(() => {
    const map = document.querySelector('.map-app')
    let selected = 'dark'
    if (!map) {
      try { selected = localStorage.getItem('charging-map-theme') === 'light' ? 'light' : 'dark' } catch { /* Optional storage. */ }
    }
    const theme = map ? getComputedStyle(map) : null
    selected = map?.dataset.theme || selected
    const background = theme?.backgroundColor || (selected === 'light' ? '#e8edf0' : '#10181e')
    if (legalView.current) legalView.current.style.backgroundColor = background
    for (const frame of Object.values(frames.current)) {
      const root = frame?.contentDocument?.documentElement
      if (!root) continue
      root.dataset.theme = selected
      root.style.colorScheme = selected
      root.style.backgroundColor = background
      if (theme) {
        for (const name of ['--panel', '--surface', '--text', '--muted', '--border', '--accent', '--shadow', '--warning', '--warning-bg']) {
          root.style.setProperty(name, theme.getPropertyValue(name))
        }
        root.style.setProperty('--page-background', background)
        root.style.fontFamily = theme.fontFamily
      }
    }
  }, [])

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
    const href = anchor.getAttribute('href')
    if (anchor.ownerDocument !== document && href.startsWith('#')) {
      // Scroll without adding iframe history entries that would trap "Zur Karte".
      try {
        const section = anchor.ownerDocument.getElementById(decodeURIComponent(href.slice(1)))
        if (section) { event.preventDefault(); section.scrollIntoView() }
      } catch { /* Preserve normal handling of malformed anchors. */ }
      return
    }
    const target = legalLinkTarget(href, baseUrl)
    if (target === 'map' && page) { event.preventDefault(); close() }
    else if (target && target !== 'map') { event.preventDefault(); open(target) }
  }, [page, close, open])

  useLayoutEffect(() => { currentFollow.current = follow }, [follow])
  useLayoutEffect(() => {
    syncTheme()
    if (page) frames.current[page]?.contentDocument?.querySelector('main a')?.focus()
  }, [page, ready, syncTheme])

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
    {(page || Object.keys(ready).length > 0) && <section ref={legalView} className="legal-view" hidden={!page} aria-label={titles[page] || 'Rechtliche Hinweise'}>
      {['datenschutz', 'impressum'].map(kind => <iframe key={kind} ref={node => { frames.current[kind] = node }} src={`${baseUrl}${kind}.html`} title={titles[kind]} aria-hidden={shownPage !== kind} tabIndex={shownPage === kind ? 0 : -1} style={{ visibility: shownPage === kind ? 'visible' : 'hidden' }} onLoad={event => {
        const frame = event.currentTarget, doc = frame.contentDocument
        syncTheme()
        doc.addEventListener('click', e => currentFollow.current?.(e))
        doc.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close() } })
        for (const anchor of doc.querySelectorAll('a[href^="https:"]')) {
          if (new URL(anchor.href).origin !== window.location.origin) {
            anchor.target = '_blank'
            anchor.rel = 'noreferrer'
          }
        }
        setReady(previous => ({ ...previous, [kind]: true }))
        if (page === kind) {
          setLastReadyPage(kind)
          doc.querySelector('main a')?.focus()
        }
      }} />)}
    </section>}
  </>
}
