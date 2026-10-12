import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tooltipPosition } from '../utils/tooltipPosition.js'

export default function HelpTooltip({ label, text, symbol, children, blocked = false }) {
  const id = useId(), [open, setOpen] = useState(false), anchor = useRef(null), popup = useRef(null), closeTimer = useRef(null)
  const [placement, setPlacement] = useState(null), [host, setHost] = useState(null)
  const cancelClose = () => clearTimeout(closeTimer.current)
  const show = () => { cancelClose(); setHost(anchor.current?.closest('.map-app')); setOpen(true) }
  const dismiss = useCallback(() => { clearTimeout(closeTimer.current); setOpen(false) }, [])
  const leave = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      if (!anchor.current?.contains(document.activeElement) && !popup.current?.contains(document.activeElement)) setOpen(false)
    }, 160)
  }
  const keys = event => {
    if (event.key === 'Escape') { event.stopPropagation(); dismiss() }
    else if (blocked && ['Enter', ' '].includes(event.key)) { event.preventDefault(); show() }
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!open) return
    const outside = event => {
      if (!anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) dismiss()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open, dismiss])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!anchor.current || !popup.current) return
      setPlacement(tooltipPosition(anchor.current.getBoundingClientRect(), popup.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, text])
  const tooltip = open && host && createPortal(<span ref={popup} id={id} role="tooltip" className="help-tooltip is-floating"
    onMouseEnter={cancelClose} onMouseLeave={leave}
    style={{ left: placement?.left ?? 12, top: placement?.top ?? 12, visibility: placement ? 'visible' : 'hidden' }}>{text}</span>, host)
  if (blocked) return <div ref={anchor} className="disabled-setting-help" role="group" aria-label={label} tabIndex={0}
    aria-describedby={open ? id : undefined} onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={dismiss} onClick={show} onKeyDown={keys}>
    {children}{tooltip}
  </div>
  return <span ref={anchor} className={`help-control${symbol ? '' : ' help-inline'}`} onMouseEnter={show} onMouseLeave={leave}>
    <button type="button" className={symbol ? 'help-button' : 'help-term'} aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
      onFocus={show} onBlur={dismiss} onClick={event => { event.stopPropagation(); show() }} onKeyDown={keys}>{symbol || children || label}</button>
    {tooltip}
  </span>
}
