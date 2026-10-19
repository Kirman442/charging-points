import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { runtimeAssetsPlugin } from './scripts/runtimeAssets.mjs'
import { languageAccessDefines } from './scripts/languageAccess.mjs'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  define: languageAccessDefines(command),
  plugins: [react(), runtimeAssetsPlugin()],
  base: '/charging-points/',
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  worker: {
    format: 'es',
  },
}))
