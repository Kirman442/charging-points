import * as maplibre from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre 6 has a separate module worker. Vite must bundle its imports too.
maplibre.setWorkerUrl(workerUrl)

export default maplibre
