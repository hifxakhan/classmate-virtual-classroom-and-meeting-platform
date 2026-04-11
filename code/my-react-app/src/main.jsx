import 'globalthis/polyfill';
window.global = window;
window.process = { env: {} };

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { TimezoneProvider } from './contexts/TimezoneContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TimezoneProvider>
      <App />
    </TimezoneProvider>
  </StrictMode>,
)
