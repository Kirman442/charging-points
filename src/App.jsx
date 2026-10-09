import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChargingMap from './components/ChargingMap.jsx'
import AutobahnPanel from './components/AutobahnPanel.jsx'
import { AUTOBAHNS, autobahnDisplayData } from './data/autobahn.js'
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
  const [autobahnFocus, setAutobahnFocus] = useState(null)
  const [showUnrouted, setShowUnrouted] = useState(false)
  const [autobahnRoute, setAutobahnRoute] = useState('A9')
  const [a9Enabled, setA9Enabled] = useState(false), [a9Direction, setA9Direction] = useState('north'), [hideOthers, setHideOthers] = useState(true)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [viewState, setViewState] = useState(GERMANY)
  const [clickedRegion, setClickedRegion] = useState(null), [mapError, setMapError] = useState('')
  const [siteMode, setSiteMode] = useState(false)
  const [cluster, setCluster] = useState(null)
  const { a9, a9Pending, a9Error, loadA9, loadAutobahn, data, markers, regions, states, detail, detailPending, status, error, selectSite, reload, onDataRendered } = useChargingData(filters, viewState.zoom, options.clusterSites && !a9Enabled, autobahnRoute)
  const activeRegion = clickedRegion
    ? regions?.[clickedRegion.level]?.find(feature => (feature.properties.district_code || feature.properties.state_code) === (clickedRegion.district_code || clickedRegion.state_code))?.properties || null
    : regions?.states.find(feature => feature.properties.state_name === filters.state)?.properties || null
  const displayData = useMemo(() => a9Enabled ? autobahnDisplayData(data, a9, a9Direction, hideOthers, showUnrouted ? 'all' : 'routed', autobahnFocus) : data, [data, a9Enabled, a9, a9Direction, hideOthers, showUnrouted, autobahnFocus])
  const mapOptions = useMemo(() => ({ ...options, a9Mode: a9Enabled, showSites: a9Enabled || options.showSites, autobahnZoom: viewState.zoom, clusterSites: options.clusterSites && !a9Enabled, metric: a9Enabled ? 'sites' : options.metric, state: filters.state, selectedRegion: activeRegion }), [options, filters.state, activeRegion, a9Enabled, viewState.zoom])
  const closeSite = useCallback(() => { setAutobahnFocus(null); setCluster(null); setSiteMode(false); selectSite(-1) }, [selectSite])
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
    setA9Enabled(false); setHideOthers(true); setShowUnrouted(false); setAutobahnFocus(null); setA9Direction('north'); setAutobahnRoute('A9')
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
    <ChargingMap data={displayData} autobahn={a9Enabled ? a9 : null} direction={a9Direction} markers={markers} regions={regions} options={mapOptions} viewState={viewState} onViewChange={onViewChange}
      onCluster={value => { setSiteMode(false); selectSite(-1); setCluster(value) }}
      onSite={index => { setCluster(null); setSiteMode(true); setAutobahnFocus(index); selectSite(index) }} onRegion={showRegion} onMapError={setMapError} onDataRendered={onDataRendered} />
    <ControlPanel autobahnRoute={autobahnRoute} onAutobahnRoute={route => { setAutobahnRoute(route); closeSite(); if (a9Enabled) { loadAutobahn(route); setViewState(previous => transitionViewState(previous, AUTOBAHNS[route].view)) } }} a9Enabled={a9Enabled} a9Direction={a9Direction} hideOthers={hideOthers} a9Available={!!data} onA9Enabled={enabled => { setA9Enabled(enabled); closeSite(); if (enabled) { if (!a9 && !a9Pending) loadA9(); setViewState(previous => transitionViewState(previous, AUTOBAHNS[autobahnRoute].view)) } }} onA9Direction={value => { setA9Direction(value); closeSite() }} onHideOthers={setHideOthers} states={states} filters={filters} onFilters={onFilters} options={options} onOptions={onOptions} onReset={resetSettings} />

    {!a9Enabled && <MapLegend regions={regions} options={mapOptions} />}
    {a9Enabled && !siteMode ? <AutobahnPanel showUnrouted={showUnrouted} onShowUnrouted={setShowUnrouted} route={autobahnRoute} pilot={a9} direction={a9Direction} pending={a9Pending} error={a9Error} onRetry={loadA9} onSite={(row, position) => { setCluster(null); setSiteMode(true); setAutobahnFocus(row); selectSite(row); setViewState(previous => ({ ...previous, longitude: position[0], latitude: position[1], zoom: Math.max(previous.zoom, 14) })) }} /> : <AnalyticsPanel autobahnSite={a9Enabled ? a9?.sites.find(s => s.site_row === autobahnFocus && s.direction === a9Direction && s.registry_site_id === detail?.site_id) : null} cluster={cluster} selectedState={filters.state} states={regions?.states} site={siteMode ? detail : null} region={activeRegion} metric={options.metric} pending={siteMode && detailPending}
      data={data} operatorBasis={options.operatorBasis} onOperatorBasis={value => onOptions({ ...options, operatorBasis: value })} showSites={options.showSites} status={status} error={error || mapError} onRetry={() => { closeSite(); setClickedRegion(null); reload() }}
      onCloseSite={returnToAnalytics} onAllTerritories={allTerritories} onOverview={overview} onSelectRegion={showRegion} />}
    <div className="source">Данные: <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html" target="_blank" rel="noreferrer">BNetzA · CC BY 4.0</a> · KBA · BKG · {a9Enabled && <><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a> · </>}обработка и группировка</div>
  </main>
}
