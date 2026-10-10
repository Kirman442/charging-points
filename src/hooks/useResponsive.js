import { useSyncExternalStore } from 'react'
import { MOBILE_QUERY as query } from '../config/layout.js'
const subscribe = callback => {
  const media = window.matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
export default function useResponsive() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
