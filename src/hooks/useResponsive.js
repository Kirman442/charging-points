import { useSyncExternalStore } from 'react'
const query = '(max-width: 767px)'
const subscribe = callback => {
  const media = window.matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
export default function useResponsive() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
