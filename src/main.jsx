import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LanguageProvider from './i18n/LanguageProvider.jsx'
import LegalShell from './legal/LegalShell.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LegalShell><LanguageProvider><App /></LanguageProvider></LegalShell>
  </StrictMode>,
)
