import { useId, useState } from 'react'
export default function HelpTooltip({ label, text, symbol = '?' }) {
  const id = useId(), [open, setOpen] = useState(false)
  return <span className="help-control" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="help-button" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}>{symbol}</button>
    {open && <span id={id} role="tooltip" className="help-tooltip">{text}</span>}
  </span>
}
