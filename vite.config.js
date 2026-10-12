import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { runtimeAssetsPlugin } from './scripts/runtimeAssets.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), runtimeAssetsPlugin()],
  base: '/charging-points/',
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  worker: {
    format: 'es',
  },
})
