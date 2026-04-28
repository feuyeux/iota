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
