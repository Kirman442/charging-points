import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { runtimeAssetsPlugin } from './scripts/runtimeAssets.mjs'
import { languageAccessDefines } from './scripts/languageAccess.mjs'
import { fileURLToPath } from 'node:url'

function memoryOnlyLogSettings() {
  return {
    name: 'memory-only-library-log-settings',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../utils/local-storage.js' && importer?.replaceAll('\\', '/').endsWith('/@probe.gl/log/dist/loggers/probe-log.js')) {
        return fileURLToPath(new URL('./src/utils/log-memory-storage.js', import.meta.url))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  define: languageAccessDefines(command),
  plugins: [
    memoryOnlyLogSettings(),
    react(), runtimeAssetsPlugin(),
  ],
  base: '/charging-points/',
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./datenschutz.html', import.meta.url)),
        imprint: fileURLToPath(new URL('./impressum.html', import.meta.url)),
      },
    },
  },
  optimizeDeps: {
    exclude: ['maplibre-gl', '@probe.gl/log'],
  },
  worker: {
    format: 'es',
    plugins: () => [memoryOnlyLogSettings()],
  },
}))
