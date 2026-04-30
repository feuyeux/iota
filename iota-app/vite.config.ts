import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor'
          }
          if (id.includes('@tanstack/react-query')) {
            return 'query'
          }
          if (id.includes('zustand')) {
            return 'state'
          }
        },
      },
    },
  },
  server: {
    port: 9888,
    proxy: {
      '/api/v1/stream': {
        target: 'http://localhost:9666',
        ws: true,
        changeOrigin: true,
      },
      '/api/v1': {
        target: 'http://localhost:9666',
        changeOrigin: true,
      },
    },
  },
})
