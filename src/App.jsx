import { useCallback, useState } from 'react'
import ChargingMap from './components/ChargingMap.jsx'
import ControlPanel from './components/ControlPanel.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import { useChargingData } from './hooks/useChargingData.js'
import { DEFAULT_FILTERS, GERMANY } from './config/map.js'
import './App.css'

export default function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [options, setOptions] = useState({ metric: 'sites', level: 'states', showSites: true, style: 'dark', state: '' })
  const [viewState, setViewState] = useState(GERMANY)
  const [region, setRegion] = useState(null), [mapError, setMapError] = useState('')
  const { data, regions, states, detail, status, error, selectSite, reload } = useChargingData(filters)
  const onFilters = useCallback(next => { setFilters(next); setRegion(null); selectSite(-1) }, [selectSite])
  const onOptions = useCallback(next => {
    setOptions({ ...next, level: next.metric !== 'sites' && next.level === 'none' ? 'states' : next.level })
    setRegion(null); selectSite(-1)
  }, [selectSite])
  return <main className="map-app">
    <ChargingMap data={data} regions={regions} options={{ ...options, state: filters.state }} viewState={viewState} onViewChange={setViewState}
      onSite={index => { setRegion(null); selectSite(index) }} onRegion={value => { selectSite(-1); setRegion(value) }} onMapError={setMapError} />
    <ControlPanel data={data} regions={regions} states={states} filters={filters} onFilters={onFilters} options={options} onOptions={onOptions}
      status={status} error={error || mapError} onRetry={() => { setRegion(null); reload() }} onReset={() => setViewState(GERMANY)} />
    <DetailPanel site={detail} region={region} onClose={() => { selectSite(-1); setRegion(null) }} />
    <div className="source">Данные: <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html" target="_blank" rel="noreferrer">BNetzA · CC BY 4.0</a> · KBA · BKG · обработка и группировка</div>
  </main>
}
