export default function Switch({ checked, onChange, disabled, children, className = '' }) {
  return <label className={`switch-row ${className}${disabled ? ' is-disabled' : ''}`}>
    <span>{children}</span>
    <span className="switch-control"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span className="switch-track" aria-hidden="true" /></span>
  </label>
}
