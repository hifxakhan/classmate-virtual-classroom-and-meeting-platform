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
        target: 'https://classmate-backend-eysi.onrender.com',
        changeOrigin: true,
        secure: false
      },
      '/socket.io': {
        target: 'https://classmate-backend-eysi.onrender.com',
        changeOrigin: true,
        secure: false,
        ws: true
      }
    }
  }
})