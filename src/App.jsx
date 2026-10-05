import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChargingMap from './components/ChargingMap.jsx'
import ControlPanel from './components/ControlPanel.jsx'
import AnalyticsPanel from './components/AnalyticsPanel.jsx'
import MapLegend from './components/MapLegend.jsx'
import { useChargingData } from './hooks/useChargingData.js'
import { DEFAULT_FILTERS, GERMANY } from './config/map.js'
import { clusterZoom } from './config/clustering.js'
import { DEFAULT_OPTIONS, normalizeOptions, territoryForSelection, resetOptions, reconcileRegion } from './map/settings.js'
import { fitRegionViewState, mapPadding, returnRegionFeature } from './map/navigation.js'
import { transitionViewState } from './map/interaction.js'
import './App.css'

export default function App() {
  const mapContainer = useRef(null), pendingFocus = useRef(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [viewState, setViewState] = useState(GERMANY)
  const [clickedRegion, setClickedRegion] = useState(null), [mapError, setMapError] = useState('')
  const [siteMode, setSiteMode] = useState(false)
  const [cluster, setCluster] = useState(null)
  const { data, markers, regions, states, detail, detailPending, status, error, selectSite, reload, onDataRendered } = useChargingData(filters, viewState.zoom, options.clusterSites)
  const activeRegion = clickedRegion
    ? regions?.[clickedRegion.level]?.find(feature => (feature.properties.district_code || feature.properties.state_code) === (clickedRegion.district_code || clickedRegion.state_code))?.properties || null
    : regions?.states.find(feature => feature.properties.state_name === filters.state)?.properties || null
  const mapOptions = useMemo(() => ({ ...options, state: filters.state, selectedRegion: activeRegion }), [options, filters.state, activeRegion])
  const closeSite = useCallback(() => { setCluster(null); setSiteMode(false); selectSite(-1) }, [selectSite])
  const focusFeature = useCallback(feature => {
    const container = mapContainer.current
    if (!feature || !container) return
    const rect = container.getBoundingClientRect()
    const controls = container.querySelector('.control-panel')?.getBoundingClientRect()
    const analytics = container.querySelector('.analytics-panel')?.getBoundingClientRect()
    setViewState(previous => fitRegionViewState(feature, rect, previous, mapPadding(rect, controls, analytics)))
  }, [])
  const focusLand = useCallback(name => {
    if (!name) {
      pendingFocus.current = null
      setViewState(previous => transitionViewState(previous, GERMANY))
      return
    }
    const feature = regions?.states?.find(feature => feature.properties.state_name === name)
    if (!feature) { pendingFocus.current = name; return }
    pendingFocus.current = null
    focusFeature(feature)
  }, [regions, focusFeature])
  const returnToAnalytics = useCallback(() => {
    closeSite()
    if (filters.state) {
      const feature = returnRegionFeature(regions, filters.state, activeRegion)
      if (feature) focusFeature(feature)
      else focusLand(filters.state)
    }
  }, [closeSite, filters.state, regions, activeRegion, focusFeature, focusLand])
  useEffect(() => {
    if (!pendingFocus.current) return
    const frame = requestAnimationFrame(() => { if (pendingFocus.current) focusLand(pendingFocus.current) })
    return () => cancelAnimationFrame(frame)
  }, [focusLand])
  const onFilters = useCallback(next => {
    setCluster(null)
    setFilters(next)
    if (next.state !== filters.state) { setClickedRegion(null); setOptions(previous => territoryForSelection(previous, next.state)); focusLand(next.state) }
    setSiteMode(false); selectSite(-1)
  }, [filters.state, selectSite, focusLand])
  const onOptions = useCallback(next => {
    const normalized = next.metric !== options.metric ? territoryForSelection(next, filters.state) : normalizeOptions(next)
    setOptions(normalized)
    if (!normalized.showSites || normalized.clusterSites !== options.clusterSites) setCluster(null)
    if (normalized.metric !== options.metric || normalized.territory !== options.territory) {
      setCluster(null); setSiteMode(false); selectSite(-1)
      setClickedRegion(previous => reconcileRegion(previous, normalized, regions))
    }
  }, [options.metric, options.territory, options.clusterSites, filters.state, regions, selectSite])
  const resetSettings = useCallback(() => {
    pendingFocus.current = null
    setViewState(GERMANY); setFilters({ ...DEFAULT_FILTERS })
    setOptions(previous => resetOptions(previous))
    setClickedRegion(null); closeSite()
  }, [closeSite])
  const showRegion = useCallback(value => {
    setCluster(null); setSiteMode(false); selectSite(-1); setClickedRegion(value)
  }, [selectSite])
  const allTerritories = useCallback(() => {
    if (filters.state) focusLand(filters.state)
    setClickedRegion(null)
    closeSite()
  }, [closeSite, filters.state, focusLand])
  const overview = useCallback(() => {
    if (filters.state) focusLand('')
    pendingFocus.current = null
    setCluster(null); setClickedRegion(null); setOptions(previous => territoryForSelection(previous, '')); setFilters(previous => ({ ...previous, state: '' })); setSiteMode(false); selectSite(-1)
  }, [selectSite, filters.state, focusLand])
  const onViewChange = useCallback(next => {
    if (clusterZoom(next.zoom) !== clusterZoom(viewState.zoom)) setCluster(null)
    setViewState(next)
  }, [viewState.zoom])
  return <main className="map-app" ref={mapContainer}>
    <ChargingMap data={data} markers={markers} regions={regions} options={mapOptions} viewState={viewState} onViewChange={onViewChange}
      onCluster={value => { setSiteMode(false); selectSite(-1); setCluster(value) }}
      onSite={index => { setCluster(null); setSiteMode(true); selectSite(index) }} onRegion={showRegion} onMapError={setMapError} onDataRendered={onDataRendered} />
    <ControlPanel states={states} filters={filters} onFilters={onFilters} options={options} onOptions={onOptions} onReset={resetSettings} />

    <MapLegend regions={regions} options={mapOptions} />
    <AnalyticsPanel cluster={cluster} selectedState={filters.state} states={regions?.states} site={siteMode ? detail : null} region={activeRegion} metric={options.metric} pending={siteMode && detailPending}
      data={data} operatorBasis={options.operatorBasis} onOperatorBasis={value => onOptions({ ...options, operatorBasis: value })} showSites={options.showSites} status={status} error={error || mapError} onRetry={() => { closeSite(); setClickedRegion(null); reload() }}
      onCloseSite={returnToAnalytics} onAllTerritories={allTerritories} onOverview={overview} onSelectRegion={showRegion} />
    <div className="source">Данные: <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html" target="_blank" rel="noreferrer">BNetzA · CC BY 4.0</a> · KBA · BKG · обработка и группировка</div>
  </main>
}
