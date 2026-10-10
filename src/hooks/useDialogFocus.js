import { useEffect } from 'react'
export default function useDialogFocus(ref, enabled, onClose) {
  useEffect(() => {
    if (!enabled) return
    const root = ref.current
    if (!root) return
    const previous = document.activeElement
    const targets = () => Array.from(root.querySelectorAll('button,select,input,a[href],summary,[tabindex="0"]')).filter(node => !node.disabled && node.getClientRects().length)
    targets()[0]?.focus()
    const keyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const nodes = targets(), first = nodes[0], last = nodes.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyDown)
    return () => { document.removeEventListener('keydown', keyDown); if (previous?.isConnected) previous.focus() }
  }, [ref, enabled, onClose])
}
