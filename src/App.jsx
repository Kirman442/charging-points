import { useCallback, useMemo, useState } from 'react'
import ChargingMap from './components/ChargingMap.jsx'
import ControlPanel from './components/ControlPanel.jsx'
import AnalyticsPanel from './components/AnalyticsPanel.jsx'
import MapLegend from './components/MapLegend.jsx'
import { useChargingData } from './hooks/useChargingData.js'
import { DEFAULT_FILTERS, GERMANY } from './config/map.js'
import { clusterZoom } from './config/clustering.js'
import { DEFAULT_OPTIONS, normalizeOptions, resetOptions, reconcileRegion } from './map/settings.js'
import './App.css'

export default function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [viewState, setViewState] = useState(GERMANY)
  const [clickedRegion, setClickedRegion] = useState(null), [mapError, setMapError] = useState('')
  const [siteMode, setSiteMode] = useState(false)
  const [cluster, setCluster] = useState(null)
  const { data, markers, regions, states, detail, detailPending, status, error, selectSite, reload } = useChargingData(filters, viewState.zoom, options.clusterSites)
  const mapOptions = useMemo(() => ({ ...options, state: filters.state }), [options, filters.state])
  const activeRegion = clickedRegion
    ? regions?.[clickedRegion.level]?.find(feature => (feature.properties.district_code || feature.properties.state_code) === (clickedRegion.district_code || clickedRegion.state_code))?.properties || null
    : regions?.states.find(feature => feature.properties.state_name === filters.state)?.properties || null
  const closeSite = useCallback(() => { setCluster(null); setSiteMode(false); selectSite(-1) }, [selectSite])
  const onFilters = useCallback(next => {
    setCluster(null)
    setFilters(next)
    if (next.state !== filters.state) setClickedRegion(null)
    setSiteMode(false); selectSite(-1)
  }, [filters.state, selectSite])
  const onOptions = useCallback(next => {
    const normalized = normalizeOptions(next)
    setOptions(normalized)
    if (!normalized.showSites || normalized.clusterSites !== options.clusterSites) setCluster(null)
    if (normalized.metric !== options.metric || normalized.territory !== options.territory) {
      setCluster(null); setSiteMode(false); selectSite(-1)
      setClickedRegion(previous => reconcileRegion(previous, normalized, regions))
    }
  }, [options.metric, options.territory, options.clusterSites, regions, selectSite])
  const resetSettings = useCallback(() => {
    setViewState(GERMANY); setFilters({ ...DEFAULT_FILTERS })
    setOptions(previous => resetOptions(previous))
    setClickedRegion(null); closeSite()
  }, [closeSite])
  const showRegion = useCallback(value => {
    setCluster(null); setSiteMode(false); selectSite(-1); setClickedRegion(value)
  }, [selectSite])
  const overview = useCallback(() => {
    setCluster(null); setClickedRegion(null); setFilters(previous => ({ ...previous, state: '' })); setSiteMode(false); selectSite(-1)
  }, [selectSite])
  const onViewChange = useCallback(next => {
    if (clusterZoom(next.zoom) !== clusterZoom(viewState.zoom)) setCluster(null)
    setViewState(next)
  }, [viewState.zoom])
  return <main className="map-app">
    <ChargingMap data={data} markers={markers} regions={regions} options={mapOptions} viewState={viewState} onViewChange={onViewChange}
      onCluster={value => { setSiteMode(false); selectSite(-1); setCluster(value) }}
      onSite={index => { setCluster(null); setSiteMode(true); selectSite(index) }} onRegion={showRegion} onMapError={setMapError} />
    <ControlPanel states={states} filters={filters} onFilters={onFilters} options={options} onOptions={onOptions} onReset={resetSettings} />

    <MapLegend regions={regions} options={mapOptions} />
    <AnalyticsPanel cluster={cluster} states={regions?.states} site={siteMode ? detail : null} region={activeRegion} metric={options.metric} pending={siteMode && detailPending}
      data={data} showSites={options.showSites} status={status} error={error || mapError} onRetry={() => { closeSite(); setClickedRegion(null); reload() }}
      onCloseSite={closeSite} onOverview={overview} onSelectRegion={showRegion} />
    <div className="source">Данные: <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html" target="_blank" rel="noreferrer">BNetzA · CC BY 4.0</a> · KBA · BKG · обработка и группировка</div>
  </main>
}
