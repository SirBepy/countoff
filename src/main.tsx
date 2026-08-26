import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Bundled rather than pulled from a CDN: the venue has no signal, and a missing
// icon font would leave every control blank.
import '@phosphor-icons/web/regular'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Only the built output ships a service worker; registering in dev would serve
// stale modules back over Vite's HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'))
}
