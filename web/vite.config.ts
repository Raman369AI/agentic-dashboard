import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['vega', 'vega-lite', 'vega-interpreter'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
})
