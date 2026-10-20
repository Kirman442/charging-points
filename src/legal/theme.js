// Restore only the existing, user-selected theme; never create a preference.
let legalTheme = 'dark'
try { legalTheme = localStorage.getItem('charging-map-theme') === 'light' ? 'light' : 'dark' } catch { /* Optional storage. */ }
document.documentElement.dataset.theme = legalTheme
document.documentElement.style.colorScheme = legalTheme
document.documentElement.style.backgroundColor = legalTheme === 'light' ? '#e8edf0' : '#10181e'
