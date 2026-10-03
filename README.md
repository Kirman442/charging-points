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
The reset-settings button resets all filters, metric, territory, boundary and
marker visibility; closes selected regions/sites and centers Germany. The basemap
choice remains unchanged.

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

## Territory and boundary controls

A single territory selector (states / KBA districts) controls both analytical fill
and contours. Boundary visibility is a separate checkbox and does not affect fill.
The ratio metric automatically selects states and locks the territory selector;
it preserves the boundary visibility choice. BEV and marker modes allow both levels.
Switching from a selected district to states opens its parent state's analytics.
Switching to districts retains a selected state's summary until a district is clicked.
The legend uses the fill's domain and selected state. Marker visibility does not
disable DC/24h filters or change the selection.

## Marker interaction and clustering

Supercluster 8.0.1 builds a spatial index in charging.worker.js for each filtered
site selection. Below zoom 12, circles show the number of sites; tooltip and
cluster details distinguish this from the sum of charging points. Cluster color
uses the highest point power among its sites. Individual sites retain power colors.
At zoom 12 and above, raw typed-array site markers are rendered without clustering.
Single-click: cluster summary in the persistent right panel, or individual site
details. Double-click: smooth zoom to the cluster expansion level (at least one
zoom level closer). Coincident sites are ungrouped at zoom 12 too. Background
double-click zooms in one level; dragging/wheel zoom remain available.
Pointer cursor, 6-pixel picking tolerance and minimum 4-pixel site radius improve
mouse interaction. Text labels are not pickable and do not block circle clicks.
Zoom queries reuse the Worker index; panning does not rebuild it. Only integer zoom
changes request a new global cluster view. Original site coordinates and records
are unchanged; the full filtered totals are used by analytics at every zoom.
Packets carry the selection request ID and zoom; obsolete replies cannot replace
clusters for a newer selection or zoom. Cluster details close on filter/metric/
territory changes, marker hiding, integer zoom changes, and reset.

Install updated dependencies with npm ci (supercluster is the only added library).
Manual checks: hover a circle; click its summary; double-click to expand; zoom past
12 and open a single site; change state/power/DC/24h; hide/show markers; reset.

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
