import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Add global polyfills for WebRTC/Simple Peer
  define: {
    global: 'globalThis',
    'process.env': {}
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