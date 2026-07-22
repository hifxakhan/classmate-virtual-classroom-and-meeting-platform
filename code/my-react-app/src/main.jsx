import 'globalthis/polyfill';
window.global = window.global || window;

// Full process polyfill — simple-peer (WebRTC) calls process.nextTick internally.
// This MUST be set before any other imports that use simple-peer.
if (!window.process || typeof window.process.nextTick !== 'function') {
    window.process = {
        env: {},
        browser: true,
        version: 'v18.0.0',
        versions: {},
        nextTick: function nextTick(fn) {
            var args = Array.prototype.slice.call(arguments, 1);
            return setTimeout(function() { fn.apply(null, args); }, 0);
        }
    };
}

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
