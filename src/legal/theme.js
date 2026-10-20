// Restore only the existing, user-selected theme; never create a preference.
try {
  document.documentElement.dataset.theme = localStorage.getItem('charging-map-theme') === 'light' ? 'light' : 'dark'
} catch {
  document.documentElement.dataset.theme = 'dark'
}
