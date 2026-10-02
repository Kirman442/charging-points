# Charging infrastructure — Germany

## Development

Work on `dev`. Run `npm ci`, then `npm run dev`.
Checks: `npm run lint`, `npm run build`, `node --test tests/data.test.mjs`.
Production preview: `npm run preview`. GitHub Actions deploys `main`.

## Structure

- `src/App.jsx`: composes the map and panels; owns UI choices.
- `src/components/ChargingMap.jsx`: DeckGL and MapLibre.
- `src/components/ControlPanel.jsx`: filters, layer controls, statistics.
- `src/components/DetailPanel.jsx`: site and regional details.
- `src/hooks/useChargingData.js`: Worker lifecycle, messages, retries, stale-result checks.
- `src/workers/charging.worker.js`: fetching, WASM decoding, filtering and detail lookup.
- `src/data/prepareSites.js`: column access, site filters and typed rendering attributes.
- `src/data/regions.js`: WKB conversion and state aggregation.
- `src/map/layers.js`: point and polygon layers.
- `src/map/maplibre.js`: MapLibre 6 worker initialization.
- `src/config/map.js`: filenames, map styles, defaults.
- `src/utils/format.js`: numeric formatting.

## Data and metrics

Loads the sites file and both display boundary files from `public/data`.
The charging points file is not loaded yet. Arrow tables remain in the Worker;
rendering arrays are transferred. All record batches are read. Each filtered
marker retains its original row index for correct detail lookup.
Region WKB is decoded to GeoJSON in the Worker (16 states, 400 KBA districts).
This is not an end-to-end zero-copy implementation.

Filters select SITES. The displayed point count includes all points at those
sites. Minimum power means at least one point at that power; DC means at least
one DC point. Those conditions can be fulfilled by different points.
24/7 means the entire site is categorized as 24_7; mixed or unknown is excluded.

State statistics use the full registry and state_name, with checked matching
to all 16 state polygons. Charging points / passenger BEV * 1000 is a comparison
of BNetzA 2026-09-01 and KBA 2026-01-01 snapshots. It is not current occupancy,
traffic demand, or guaranteed access. Region statistics do not change when
site power/DC/hours filters change. The state selector restricts displayed
regions; choropleth scaling recalculates across the displayed regions.

Districts show BEV and passenger-car counts. Charging ratios at district level
are postponed until KBA/BNetzA territorial matching is checked. Display geometry
is simplified and should not be used for precise spatial assignment. Trier city
and Trier-Saarburg are combined to match KBA's registration district.

The 16 state BEV total excludes KBA's geographically unassigned Sonstige category.
Source references and transformation details are in `public/data/README*.txt`.
Map tiles are external CARTO/OpenStreetMap; MapLibre displays attribution.

Vite base is `/charging-points/`. Explicit MapLibre worker URL and `?worker&url`
are required for version 6. No extra WASM plugins or isolation headers are used.

## Validation

Build and ESLint pass. Data tests check full row/point totals, all boundaries,
state aggregation, combined filters, empty selections and original row IDs.
Browser rendering of the expanded interface still needs a local visual check.

## Coordinate audit

The public charging tables now contain the accepted subset: 67,680 sites and 208,570 points. All state aggregates use these files. No exclusion counts are shown on the map. See data-quality/2026-09-01/README.md and scripts/audit_coordinates.py for methodology and developer diagnostics.

## Interface step 3

ControlPanel owns settings only. MapStats and MapLegend are separate fixed
map overlays. AnalyticsPanel stays mounted: the state selector immediately
resolves region analytics, and metric selection changes the headline and the
state ranking. Germany's points/BEV ratio uses totals, not an average of ratios.
The Worker retains the previous site details while a new request is pending;
stale replies are ignored, and the panel shows a loading status without disappearing.
A click on a site replaces the analytics content; Back returns to the selected
region. All states clears the state selection but preserves other site filters.
The overview is a ranking of states; district details still open from the map.
No new dependencies or data-file replacements are required for this UI step.
Checks: `npm run lint`, `npm run build`, `node --test tests/*.test.mjs`.
Browser layout and live interactions still need a local visual check.
Boundary controls and clustering remain separate follow-up tasks.
