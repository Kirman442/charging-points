import { useCallback, useMemo, useState } from 'react'
import ChargingMap from './components/ChargingMap.jsx'
import ControlPanel from './components/ControlPanel.jsx'
import AnalyticsPanel from './components/AnalyticsPanel.jsx'
import MapStats from './components/MapStats.jsx'
import MapLegend from './components/MapLegend.jsx'
import { useChargingData } from './hooks/useChargingData.js'
import { resolveRegion } from './data/analytics.js'
import { DEFAULT_FILTERS, GERMANY } from './config/map.js'
import './App.css'

export default function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [options, setOptions] = useState({ metric: 'sites', level: 'states', showSites: true, style: 'dark' })
  const [viewState, setViewState] = useState(GERMANY)
  const [clickedRegion, setClickedRegion] = useState(null), [mapError, setMapError] = useState('')
  const [siteMode, setSiteMode] = useState(false)
  const { data, regions, states, detail, detailPending, status, error, selectSite, reload } = useChargingData(filters)
  const mapOptions = useMemo(() => ({ ...options, state: filters.state }), [options, filters.state])
  const activeRegion = resolveRegion(regions?.states, filters.state, clickedRegion)
  const closeSite = useCallback(() => { setSiteMode(false); selectSite(-1) }, [selectSite])
  const onFilters = useCallback(next => {
    setFilters(next)
    if (next.state !== filters.state) setClickedRegion(null)
    setSiteMode(false); selectSite(-1)
  }, [filters.state, selectSite])
  const onOptions = useCallback(next => {
    setOptions({ ...next, level: next.metric !== 'sites' && next.level === 'none' ? 'states' : next.level })
    if (next.metric !== options.metric) {
      setSiteMode(false); selectSite(-1)
      if (next.metric === 'ratio' && clickedRegion?.level === 'districts') setClickedRegion(null)
    }
  }, [options.metric, clickedRegion, selectSite])
  const showRegion = useCallback(value => {
    setSiteMode(false); selectSite(-1); setClickedRegion(value)
  }, [selectSite])
  const overview = useCallback(() => {
    setClickedRegion(null); setFilters(previous => ({ ...previous, state: '' })); setSiteMode(false); selectSite(-1)
  }, [selectSite])
  return <main className="map-app">
    <ChargingMap data={data} regions={regions} options={mapOptions} viewState={viewState} onViewChange={setViewState}
      onSite={index => { setSiteMode(true); selectSite(index) }} onRegion={showRegion} onMapError={setMapError} />
    <ControlPanel states={states} filters={filters} onFilters={onFilters} options={options} onOptions={onOptions} onReset={() => setViewState(GERMANY)} />
    <MapStats data={data} showSites={options.showSites} status={status} error={error || mapError} onRetry={() => { closeSite(); setClickedRegion(null); reload() }} />
    <MapLegend regions={regions} options={mapOptions} />
    <AnalyticsPanel states={regions?.states} site={siteMode ? detail : null} region={activeRegion} metric={options.metric} pending={siteMode && detailPending}
      onCloseSite={closeSite} onOverview={overview} onSelectRegion={showRegion} />
    <div className="source">Данные: <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html" target="_blank" rel="noreferrer">BNetzA · CC BY 4.0</a> · KBA · BKG · обработка и группировка</div>
  </main>
}
