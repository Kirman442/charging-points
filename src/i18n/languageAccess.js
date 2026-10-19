// Editorial convenience only: both translations remain in the client bundle.
export async function allowReview(search, expectedHash, subtle = globalThis.crypto?.subtle) {
  const key = new URLSearchParams(search).get('review')
  if (!key || !/^[A-Za-z0-9_-]{24,128}$/.test(key) || !/^[a-f0-9]{64}$/.test(expectedHash || '')) return false
  try {
    const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(key))
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('') === expectedHash
  } catch { return false }
}

export function savedLanguage(storage) {
  try { return (storage ?? globalThis.localStorage).getItem('charging-language') === 'ru' ? 'ru' : 'de' } catch { return 'de' }
}
