import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Polyfill: simple-peer uses process.nextTick at runtime (handled in main.jsx).
  // Only define `global` here — process is polyfilled in main.jsx before imports.
  define: {
    global: 'globalThis',
  },
  
  // Optimize dependencies for video call
  optimizeDeps: {
    include: ['simple-peer', 'socket.io-client']
  },
  
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },
      '/socket.io': {
        target: process.env.VITE_API_URL || 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        ws: true
      }
    }
  }
})