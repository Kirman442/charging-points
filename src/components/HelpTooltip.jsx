import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
export default function HelpTooltip({ label, text, symbol = '?', floating = false }) {
  const id = useId(), [open, setOpen] = useState(false), anchor = useRef(null), popup = useRef(null)
  const [placement, setPlacement] = useState(null), [host, setHost] = useState(null)
  const show = () => { if (floating) setHost(anchor.current?.closest('.map-app')); setOpen(true) }
  useLayoutEffect(() => {
    if (!open || !floating) return
    const place = () => {
      if (!anchor.current || !popup.current) return
      const a = anchor.current.getBoundingClientRect(), box = popup.current.getBoundingClientRect()
      const left = Math.max(12, Math.min(a.right - box.width, window.innerWidth - box.width - 12))
      const below = a.bottom + 6
      const top = below + box.height <= window.innerHeight - 12 ? below : Math.max(12, a.top - box.height - 6)
      setPlacement({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, floating, text])
  const tooltip = open && <span ref={popup} id={id} role="tooltip" className={`help-tooltip${floating ? ' is-floating' : ''}`} style={floating ? { left: placement?.left ?? 12, top: placement?.top ?? 12, visibility: placement ? 'visible' : 'hidden' } : undefined}>{text}</span>
  return <span ref={anchor} className="help-control" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="help-button" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
      onFocus={show} onBlur={() => setOpen(false)} onClick={show}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}>{symbol}</button>
    {floating && host ? createPortal(tooltip, host) : tooltip}
  </span>
}
