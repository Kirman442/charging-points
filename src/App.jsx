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
import MapChrome from './components/MapChrome.jsx'
import PanelShell from './components/PanelShell.jsx'
import ResultsPanel from './components/ResultsPanel.jsx'
import useResponsive from './hooks/useResponsive.js'
import useDialogFocus from './hooks/useDialogFocus.js'
import { zoomViewState } from './map/interaction.js'
import { isMobileWidth } from './config/layout.js'
import './App.css'
const COUNTRY = { geometry: { type: 'Polygon', coordinates: [[[5.86,47.27],[15.05,47.27],[15.05,55.1],[5.86,55.1],[5.86,47.27]]] } }
function initialOptions() {
  try { const style = localStorage.getItem('charging-map-theme'); return { ...DEFAULT_OPTIONS, style: style === 'light' ? 'light' : 'dark' } } catch { return DEFAULT_OPTIONS }
}

export default function App() {
  const mapContainer = useRef(null), pendingFocus = useRef(null)
  const [autobahnFocus, setAutobahnFocus] = useState(null)
  const [showUnrouted, setShowUnrouted] = useState(false)
  const [autobahnRoute, setAutobahnRoute] = useState('A9')
  const [a9Enabled, setA9Enabled] = useState(false), [a9Direction, setA9Direction] = useState('north'), [hideOthers, setHideOthers] = useState(true)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [options, setOptions] = useState(initialOptions)
  const mobile = useResponsive()
  const dialogRef = useRef(null), legendRef = useRef(null), initialFit = useRef(false)
  const [controlsOpen, setControlsOpen] = useState(false), [controlTab, setControlTab] = useState('filters')
  const [analyticsOpen, setAnalyticsOpen] = useState(true), [sheetState, setSheetState] = useState('peek')
  const [legendOpen, setLegendOpen] = useState(false), [listOpen, setListOpen] = useState(false)
  const [listCenter, setListCenter] = useState(GERMANY), [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS)
  const [listReturn, setListReturn] = useState(null)
  const listScroll = useRef(0)
  const [selectedSegment, setSelectedSegment] = useState(null)
  const controlsVisible = controlsOpen && !legendOpen
  const dismissLegendClick = useRef(false)
  const legendAnalytics = useRef(null)
  const closeLegend = useCallback(() => {
    setLegendOpen(false)
    if (legendAnalytics.current !== null) setAnalyticsOpen(legendAnalytics.current)
    legendAnalytics.current = null
  }, [])
  const toggleLegend = () => {
    if (legendOpen) { closeLegend(); return }
    legendAnalytics.current = mobile ? analyticsOpen : null
    setLegendOpen(true)
    if (mobile) setAnalyticsOpen(false)
  }
  useEffect(() => {
    if (!legendOpen) return
    const dismiss = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeLegend()
    }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [legendOpen, closeLegend])
  const closeControls = useCallback(() => setControlsOpen(false), [])
  useDialogFocus(dialogRef, mobile && controlsVisible, closeControls)
  useDialogFocus(legendRef, mobile && legendOpen && controlsOpen, closeLegend)
  useEffect(() => { try { localStorage.setItem('charging-map-theme', options.style) } catch { /* Storage is optional. */ } }, [options.style])
  const revealAnalytics = useCallback(() => { setListReturn(null); setAnalyticsOpen(true); setListOpen(false); setSheetState('half'); setLegendOpen(false); if (window.innerWidth < 1200) setControlsOpen(false) }, [])
  const [viewState, setViewState] = useState(GERMANY)
  const [clickedRegion, setClickedRegion] = useState(null), [mapError, setMapError] = useState('')
  const rankingView = useRef(null)
  const [analyticsRevision, setAnalyticsRevision] = useState(0)
  const [siteMode, setSiteMode] = useState(false)
  const [cluster, setCluster] = useState(null)
  const effectiveFilters = useMemo(() => a9Enabled ? { ...filters, state: '' } : filters, [filters, a9Enabled])
  const { a9, a9Pending, a9Error, loadA9, loadAutobahn, data, markers, regions, states, detail, detailPending, status, error, selectSite, reload, onDataRendered } = useChargingData(effectiveFilters, viewState.zoom, options.clusterSites && !a9Enabled, autobahnRoute)
  const activeRegion = clickedRegion
    ? regions?.[clickedRegion.level]?.find(feature => (feature.properties.district_code || feature.properties.state_code) === (clickedRegion.district_code || clickedRegion.state_code))?.properties || null
    : regions?.states.find(feature => feature.properties.state_name === filters.state)?.properties || null
  const displayData = useMemo(() => a9Enabled ? autobahnDisplayData(data, a9, a9Direction, hideOthers, showUnrouted ? 'all' : 'routed', autobahnFocus) : data, [data, a9Enabled, a9, a9Direction, hideOthers, showUnrouted, autobahnFocus])
  const mapOptions = useMemo(() => ({ ...options, a9Mode: a9Enabled, showSites: a9Enabled || options.showSites, autobahnZoom: viewState.zoom, clusterSites: options.clusterSites && !a9Enabled, metric: a9Enabled ? 'sites' : options.metric, territory: a9Enabled ? 'states' : options.territory, state: a9Enabled ? '' : filters.state, selectedRegion: a9Enabled ? null : activeRegion }), [options, filters.state, activeRegion, a9Enabled, viewState.zoom])
  const closeSite = useCallback(() => { setListReturn(null); setAutobahnFocus(null); setCluster(null); setSiteMode(false); selectSite(-1) }, [selectSite])
  const focusFeature = useCallback((feature, maxZoom = 11) => {
    const container = mapContainer.current
    if (!feature || !container) return
    const rect = container.getBoundingClientRect()
    const controls = !isMobileWidth(rect.width) ? container.querySelector('.control-panel')?.getBoundingClientRect() : null
    const analytics = container.querySelector('.analytics-shell:not([hidden])')?.getBoundingClientRect()
    setViewState(previous => fitRegionViewState(feature, rect, previous, mapPadding(rect, controls, analytics), maxZoom))
  }, [])
  const focusLand = useCallback(name => {
    if (!name) {
      pendingFocus.current = null
      focusFeature(COUNTRY)
      return
    }
    const feature = regions?.states?.find(feature => feature.properties.state_name === name)
    if (!feature) { pendingFocus.current = name; return }
    pendingFocus.current = null
    focusFeature(feature)
  }, [regions, focusFeature])
  const returnToAnalytics = useCallback(() => {
    const savedList = listReturn
    closeSite()
    if (savedList) {
      setViewState(previous => transitionViewState(previous, savedList.view))
      setListOpen(true); setAnalyticsOpen(true); setSheetState(savedList.sheet)
      return
    }
    if (!a9Enabled && filters.state) {
      const feature = returnRegionFeature(regions, filters.state, activeRegion)
      if (feature) focusFeature(feature)
      else focusLand(filters.state)
    }
  }, [closeSite, filters.state, regions, activeRegion, focusFeature, focusLand, a9Enabled, listReturn])
  useEffect(() => {
    if (!pendingFocus.current) return
    const frame = requestAnimationFrame(() => { if (pendingFocus.current) focusLand(pendingFocus.current) })
    return () => cancelAnimationFrame(frame)
  }, [focusLand])
  const onFilters = useCallback(next => {
    setListReturn(null)
    rankingView.current = null
    setCluster(null); setAutobahnFocus(null); setSelectedSegment(null)
    setFilters(next)
    if (next.state !== filters.state) { setClickedRegion(null); setOptions(previous => territoryForSelection(previous, next.state)); focusLand(next.state) }
    setSiteMode(false); selectSite(-1)
  }, [filters.state, selectSite, focusLand])
  const onOptions = useCallback(next => {
    const normalized = next.metric !== options.metric ? territoryForSelection(next, filters.state) : normalizeOptions(next)
    setOptions(normalized)
    if (!normalized.showSites || normalized.clusterSites !== options.clusterSites) setCluster(null)
    if (normalized.metric !== options.metric || normalized.territory !== options.territory) {
      setListReturn(null)
      setCluster(null); setAutobahnFocus(null); setSiteMode(false); selectSite(-1)
      setClickedRegion(previous => reconcileRegion(previous, normalized, regions))
    }
  }, [options.metric, options.territory, options.clusterSites, filters.state, regions, selectSite])
  const resetSettings = useCallback(() => {
    rankingView.current = null
    pendingFocus.current = null
    setSheetState('peek'); setAnalyticsOpen(true); setListOpen(false); setLegendOpen(false)
    setA9Enabled(false); setHideOthers(true); setShowUnrouted(false); setAutobahnFocus(null); setA9Direction('north'); setAutobahnRoute('A9')
    focusFeature(COUNTRY); setSelectedSegment(null); setFilters({ ...DEFAULT_FILTERS })
    setOptions(previous => resetOptions(previous))
    setClickedRegion(null); closeSite()
  }, [closeSite, focusFeature])
  const showRegion = useCallback(value => {
    rankingView.current = null
    setAnalyticsRevision(value => value + 1)
    setCluster(null); setSiteMode(false); setAutobahnFocus(null); selectSite(-1); setClickedRegion(value); revealAnalytics()
  }, [selectSite, revealAnalytics])
  const showRankedRegion = useCallback(value => {
    setAnalyticsRevision(value => value + 1)
    if (!rankingView.current) rankingView.current = { ...viewState }
    setCluster(null); setSiteMode(false); setAutobahnFocus(null); selectSite(-1); setClickedRegion(value); revealAnalytics()
    const feature = regions?.states.find(item => item.properties.state_code === value.state_code)
    requestAnimationFrame(() => focusFeature(feature))
  }, [viewState, regions, selectSite, revealAnalytics, focusFeature])
  const allTerritories = useCallback(() => {
    setAnalyticsRevision(value => value + 1)
    if (filters.state) focusLand(filters.state)
    setClickedRegion(null)
    closeSite()
  }, [closeSite, filters.state, focusLand])
  const overview = useCallback(() => {
    setAnalyticsRevision(value => value + 1)
    if (rankingView.current) {
      const saved = rankingView.current
      setViewState(previous => transitionViewState(previous, saved))
      rankingView.current = null
    } else if (filters.state) focusLand('')
    pendingFocus.current = null
    setCluster(null); setAutobahnFocus(null); setClickedRegion(null); setOptions(previous => territoryForSelection(previous, '')); setFilters(previous => ({ ...previous, state: '' })); setSiteMode(false); selectSite(-1)
  }, [selectSite, filters.state, focusLand])
  const onViewChange = useCallback(next => {
    if (clusterZoom(next.zoom) !== clusterZoom(viewState.zoom)) setCluster(null)
    setViewState(next)
  }, [viewState.zoom])
  useEffect(() => {
    if (initialFit.current) return
    const frame = requestAnimationFrame(() => { initialFit.current = true; focusFeature(COUNTRY) })
    return () => cancelAnimationFrame(frame)
  }, [focusFeature])
  const focusRoute = useCallback(() => {
    if (a9?.segments.length) focusFeature({ geometry: { type: 'MultiLineString', coordinates: a9.segments.filter(segment => segment.direction === a9Direction).map(segment => segment.path) } })
    else setViewState(previous => transitionViewState(previous, AUTOBAHNS[autobahnRoute].view))
  }, [a9, a9Direction, autobahnRoute, focusFeature])
  useEffect(() => {
    if (!a9Enabled || !a9) return
    const frame = requestAnimationFrame(focusRoute)
    return () => cancelAnimationFrame(frame)
  }, [a9Enabled, a9, focusRoute])
  const openControls = tab => {
    if (controlsOpen && controlTab === tab) { closeControls(); return }
    setLegendOpen(false); setDraftFilters(filters); setControlTab(tab); setControlsOpen(true)
    if (window.innerWidth < 1200 && !mobile) setAnalyticsOpen(false)
  }
  const selectMapSite = index => { setCluster(null); setSelectedSegment(null); setSiteMode(true); setAutobahnFocus(index); selectSite(index); revealAnalytics() }
  const focusSite = (row, position) => {
    selectMapSite(row)
    requestAnimationFrame(() => focusFeature({ geometry: { type: 'MultiPoint', coordinates: [[position[0]-.005,position[1]-.005],[position[0]+.005,position[1]+.005]] } }, 14))
  }
  const title = listOpen ? 'Площадки рядом' : siteMode ? (detail?.city || 'Зарядная площадка') : cluster ? 'Группа площадок' : a9Enabled ? `${autobahnRoute} · ${AUTOBAHNS[autobahnRoute][a9Direction]}` : activeRegion?.display_name || activeRegion?.district_name || activeRegion?.state_name || 'Германия'
  const routeSummary = a9?.summary.find(item => item.direction === a9Direction)
  const summary = cluster || activeRegion || {}
  return <main className={`map-app theme-${options.style}`} data-theme={options.style} ref={mapContainer}
    onPointerDownCapture={event => {
      dismissLegendClick.current = false
      if (!legendOpen || event.target.closest('.map-legend, .quick-layer')) return
      if (controlsOpen) {
        // Restoring settings consumes this gesture; a standalone legend lets it reach the map.
        event.preventDefault(); event.stopPropagation()
        dismissLegendClick.current = true
      }
      closeLegend()
    }}
    onClickCapture={event => {
      if (!dismissLegendClick.current) return
      event.preventDefault(); event.stopPropagation(); dismissLegendClick.current = false
    }}
    onPointerUpCapture={() => { if (dismissLegendClick.current) requestAnimationFrame(() => { dismissLegendClick.current = false }) }}>
    <div className="map-surface" inert={mobile && controlsVisible || undefined}>
      <ChargingMap data={displayData} autobahn={a9Enabled ? a9 : null} direction={a9Direction} markers={markers} regions={regions} options={mapOptions} viewState={viewState} onViewChange={onViewChange}
        selectedSite={autobahnFocus} selectedCluster={cluster} selectedSegment={selectedSegment} mobile={mobile}
        onSegment={segment => { setSelectedSegment(segment); revealAnalytics() }}
        onCluster={value => { setSiteMode(false); setAutobahnFocus(null); selectSite(-1); setCluster(value); revealAnalytics() }}
        onSite={selectMapSite} onRegion={showRegion} onMapError={setMapError} onDataRendered={onDataRendered} />
    </div>
    <MapChrome options={options} onOptions={onOptions} onQuickMetric={metric => { onOptions({ ...options, metric }); if (!controlsVisible && !legendOpen) toggleLegend() }} filters={filters} onFilters={onFilters} controlsOpen={controlsVisible} controlTab={controlTab} onDirection={value => { setA9Direction(value); setSelectedSegment(null); closeSite() }} onControls={openControls}
      analyticsOpen={analyticsOpen} onAnalytics={() => { setAnalyticsOpen(value => !value); if (window.innerWidth < 1200) closeControls() }}
      listOpen={listOpen} onList={() => { setListReturn(null); listScroll.current = 0; setListCenter(viewState); setListOpen(value => !value); setAnalyticsOpen(true); setSheetState('half'); if (window.innerWidth < 1200) closeControls() }}
      a9Enabled={a9Enabled} route={autobahnRoute} direction={a9Direction} legendOpen={legendOpen} onLegend={() => { if (a9Enabled) revealAnalytics(); else toggleLegend() }} modalOpen={mobile && controlsVisible}
      onHome={() => a9Enabled ? focusRoute() : focusLand(filters.state)} onZoom={delta => setViewState(previous => transitionViewState(previous, { ...previous, zoom: Math.max(3, Math.min(18, previous.zoom + delta)) }))} />
    {mobile && controlsVisible && <div className="dialog-backdrop" onClick={closeControls} />}
    {controlsOpen && <div ref={dialogRef} hidden={!controlsVisible} className="control-shell" role={mobile ? 'dialog' : undefined} aria-modal={mobile || undefined} aria-label="Настройки карты">
      <ControlPanel key={controlTab} initialTab={controlTab} onTab={setControlTab} mobile={mobile} onClose={closeControls} onLegend={a9Enabled ? undefined : toggleLegend} onApply={() => { if (Object.keys(filters).some(key => filters[key] !== draftFilters[key])) onFilters(draftFilters); closeControls() }}
        autobahnRoute={autobahnRoute} onAutobahnRoute={route => { setAutobahnRoute(route); setSelectedSegment(null); closeSite(); if (a9Enabled) { loadAutobahn(route); setViewState(previous => transitionViewState(previous, AUTOBAHNS[route].view)) } }}
        a9Enabled={a9Enabled} a9Direction={a9Direction} hideOthers={hideOthers} a9Available={!!data}
        onA9Enabled={enabled => { setA9Enabled(enabled); setSelectedSegment(null); closeSite(); if (enabled) { pendingFocus.current = null; if (!a9 && !a9Pending) loadA9(); setViewState(previous => transitionViewState(previous, AUTOBAHNS[autobahnRoute].view)) } else { focusLand(filters.state) } }}
        onA9Direction={value => { setA9Direction(value); setSelectedSegment(null); closeSite() }} onHideOthers={setHideOthers} states={states} filters={mobile ? draftFilters : filters} onFilters={mobile ? setDraftFilters : onFilters} options={options} onOptions={onOptions} onReset={() => { resetSettings(); setDraftFilters(DEFAULT_FILTERS) }} />
    </div>}
    {!a9Enabled && <div ref={legendRef} inert={mobile && controlsVisible || undefined}><MapLegend regions={regions} options={mapOptions} open={legendOpen} onToggle={toggleLegend} /></div>}
    <div inert={mobile && controlsVisible || undefined}>
      <PanelShell mobile={mobile} state={sheetState} onState={setSheetState} onClose={() => setAnalyticsOpen(false)} hidden={!analyticsOpen} title={title}
        sites={siteMode ? 1 : summary.sites ?? data?.count ?? 0} points={siteMode ? detail?.selected_point_count ?? 0 : summary.points ?? data?.totalPoints ?? 0} routeSummary={a9Enabled && !siteMode && !listOpen ? routeSummary : null} pending={!data || siteMode && detailPending || a9Enabled && a9Pending} error={error || (a9Enabled ? a9Error : '') || mapError}>
        {listOpen ? <ResultsPanel data={displayData} center={listCenter} scrollMemory={listScroll} onScroll={value => { listScroll.current = value }} onRefresh={() => { listScroll.current = 0; setListCenter(viewState) }} onSelect={row => { const saved = { view: { ...viewState }, sheet: sheetState }; focusSite(row.rowIndex, [row.longitude, row.latitude]); setListReturn(saved) }} /> : a9Enabled && !siteMode ? <AutobahnPanel showUnrouted={showUnrouted} onShowUnrouted={setShowUnrouted} route={autobahnRoute} pilot={a9} selectedSegment={selectedSegment} direction={a9Direction} pending={a9Pending} error={a9Error} onRetry={loadA9} onSite={focusSite} /> :
          <AnalyticsPanel visible={analyticsOpen && (!mobile || sheetState !== 'peek')} closeSiteLabel={listReturn ? 'К списку' : 'К аналитике'} navigationRevision={analyticsRevision} autobahnSite={a9Enabled ? a9?.sites.find(s => s.site_row === autobahnFocus && s.direction === a9Direction && s.registry_site_id === detail?.site_id) : null} cluster={cluster} onZoomCluster={() => { setViewState(previous => zoomViewState(previous, cluster)); setCluster(null) }} selectedState={filters.state} states={regions?.states} site={siteMode ? detail : null} region={activeRegion} metric={options.metric} pending={siteMode && detailPending}
            data={data} operatorBasis={options.operatorBasis} onOperatorBasis={value => onOptions({ ...options, operatorBasis: value })} showSites={options.showSites} status={status} error={error || mapError} onRetry={() => { closeSite(); setClickedRegion(null); reload() }} onCloseSite={returnToAnalytics} onAllTerritories={allTerritories} onOverview={overview} onSelectRegion={showRankedRegion} />}
      </PanelShell>
    </div>
    <div className="source">Данные: <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html" target="_blank" rel="noreferrer">BNetzA · CC BY 4.0</a> · KBA · BKG · {a9Enabled && <><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OSM · ODbL</a> · </>}обработка и группировка</div>
  </main>
}
