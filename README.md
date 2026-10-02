# Charging infrastructure — Germany

React + deck.gl + MapLibre + Arrow/Parquet Workers.
Work on dev; GitHub Actions deploys main. Vite base: /charging-points/.
Run npm ci, npm run dev. Checks: npm run lint, npm run build,
node --test tests/*.test.mjs. Production preview: npm run preview.

## Panels and selection

ControlPanel: compact controls on the left. AnalyticsPanel: persistent panel on
the right with the current selection's sites and charging points, metric headline,
regional details and state ranking. No separate top statistics panel is rendered.
MapLegend: permanently separate from the control scroll area.
Selecting a state immediately resolves its analytics. Site details replace regional
contents without unmounting the panel; previous contents remain while loading.
The reset-selection button resets state/power/DC/24_7, closes selected regions/sites,
and centers Germany. Metric, boundary settings, basemap and marker visibility remain.

## Filtering and metrics

Filters select sites: minimum power means at least one suitable point; DC means
at least one DC point. Conditions may refer to different points. 24/7 means the
whole site is categorized 24_7. All points at selected sites are counted.
Filters update BOTH map and analytics: site/point totals, state and district
aggregates, rankings and ratio colors. BEV counts and their denominators remain
unchanged. National ratio = selected points / BEV across the 16 states * 1000,
not an average of state ratios. KBA Sonstige is not included in the 16-state total.
An empty selection yields zero charging counts, retaining automobile counts.
BNetzA 2026-09-01 vs KBA 2026-01-01: comparison of snapshots, not live availability.

## Spatial data

Accepted charging tables: 67,680 sites, 208,570 points. Coordinate validation is
recorded in data-quality/2026-09-01. Exclusion counts are not shown on the map.
New site_district_counts_zstd10.parquet is a compact site/district point-count index,
built using original equipment coordinates and unsimplified KBA district polygons.
All 208,570 points are assigned; no snapping, unmatched equipment, or boundary ties.
There are 67,681 site/district rows: ONE site has equipment in TWO districts.
Each district counts that site once and only its own points; Germany counts the
site once. Consequently, summed district site counts can exceed the national
site count. Point counts reconcile exactly. Do not use simplified display polygons
for spatial assignment.
District labels come from BKG VG250 GEN/BEZ. All Kreisfreie Stadt and Stadtkreis
are labeled as autonomous cities; names retain proper spelling and accents.
Region Hannover, Städteregion Aachen, Regionalverband Saarbrücken and combined
Trier / Trier-Saarburg are identified separately. Trier follows KBA territory.

## Structure

src/App.jsx: UI composition and selection state.
src/components: map, controls, analytics, legend.
src/hooks/useChargingData.js: Worker messages, retries and stale-result checks.
src/workers/charging.worker.js: loading, decoding, filtering and aggregation.
src/data/prepareSites.js: typed rendering attributes and original row IDs.
src/data/regions.js: region decoding, district links and regional counts.
src/map: layers and explicit MapLibre 6 worker initialization.
src/config/map.js: files, styles and defaults. src/utils: format and territory labels.

The Worker loads sites, boundaries, the compact district index and district labels;
it does not load the full charging-points table in the browser. Rendering arrays are
transferred, geometry decoded to GeoJSON; the pipeline is not end-to-end zero-copy.
Map tiles are external CARTO/OpenStreetMap; MapLibre displays attribution.
For reproducible spatial indexing, scripts/prepare_district_index.py requires
pyarrow, shapely>=2, pyproj, numpy; arguments: --districts-original PATH,
--states-original PATH, --gpkg PATH (and optional --repo PATH).

## Validation and remaining work

Build, ESLint and ten data/analytics tests pass. Panel markup is checked separately.
Live layout/interaction should be verified locally. On small screens control scroll
is retained rather than clipping controls. Clustering, region highlight/fly-to,
boundary-control redesign and load optimization remain separate steps.
