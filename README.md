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

Power and DC filter charging points jointly: the same point must meet both
conditions. A site remains visible if at least one of its points qualifies.
State and whole-site 24/7 remain site conditions. Site counters count represented
locations; point counters and distributions count eligible points; installation
counters and nominal power count installations with eligible points once, using
the full reported nominal installation power, not a proportional point allocation.
Site details distinguish eligible counts/power from whole-site totals.

Filters update map markers, cluster counts, state/district aggregates, operator
shares, concentration and normalized metrics. BEV denominators remain unchanged.
National ratios use aggregate totals across 16 states, excluding KBA Sonstige.
An empty selection has zero infrastructure counts and null concentration, with
unchanged automobile counts. BNetzA 2026-09-01 vs KBA 2026-01-01 are snapshots.

## Territory and boundary controls

A single territory selector (states / KBA districts) controls both analytical fill
and contours. Boundary visibility is a separate checkbox and does not affect fill.
BEV, points per 1,000 BEV and kW per 1,000 BEV default to KBA districts when
a state is selected and to states for All Germany. Changing one of these metrics
also applies that default. Manual territory changes remain available; power/DC/24h
filters preserve them. Boundary and marker visibility are independent. Marker
mode does not automatically change the territory level.
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
details. Double-click: short, monotonic zoom to the cluster expansion level (at least one
zoom level closer). Coincident sites are ungrouped at zoom 12 too. Background
double-click zooms in one level; dragging/wheel zoom remain available.
Pointer cursor only over site/cluster markers; grab over regions and the background.
6-pixel picking tolerance and minimum 4-pixel site radius improve
mouse interaction. Text labels are not pickable and do not block circle clicks.
Zoom queries reuse the Worker index; panning does not rebuild it. Only integer zoom
changes request a new global cluster view. Original site coordinates and records
are unchanged; the full filtered totals are used by analytics at every zoom.
Packets carry the selection request ID and zoom; obsolete replies cannot replace
clusters for a newer selection. During zoom changes, the last valid cluster view
for the same selection stays visible until the new zoom packet arrives. If none
is available, raw sites are shown temporarily instead of a blank marker layer. Cluster details close on filter/metric/
territory changes, marker hiding, integer zoom changes, and reset.

The Group sites checkbox defaults to enabled; disabling it shows individual
sites at every zoom and pauses zoom queries. Filter results and analytics do not
change. Reset re-enables grouping. Click zoom uses a 280 ms linear interpolation
with smooth easing and permits interruption by further interaction.

Install updated dependencies with npm ci (supercluster is the only added library).
Manual checks: hover a circle; click its summary; double-click to expand; zoom past
12 and open a single site; change state/power/DC/24h; hide/show markers; reset.

## State selection and click latency

Selecting a state in the dropdown smoothly fits its complete geometry, including
multipart states such as Bremen, in the available map area. Desktop padding is
measured from the actual left/right panels. On mobile, vertical padding is capped
to retain usable map space. Selecting All Germany restores the overview. Power,
DC and opening-hours filters do not move the camera. If boundaries are still
loading, only the latest requested state is focused once they arrive; reset
cancels that pending focus. Geometry bounds are cached; no network calls are added.
The single-click recognizer interval is reduced from 300 to 200 ms. The double-click
interval is unchanged, so a quick first-click summary may appear before zooming.

## Spatial data

Accepted charging tables: 67,680 sites, 208,570 points. Coordinate validation is
recorded in data-quality/2026-09-01. Exclusion counts are not shown on the map.
New site_district_counts_zstd10.parquet is a compact site/district point-count index,
built using original equipment coordinates and unsimplified KBA district polygons.
All 208,570 points are assigned; no snapping, unmatched equipment, or boundary ties.
There are 67,681 site/district rows: ONE site has equipment in TWO districts.
Each district counts that site once and only its own points; Germany counts the
site once. Consequently, summed district site counts can exceed the national
site count. Point counts, installation counts and nominal power reconcile across districts. Do not use simplified display polygons
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

The Worker loads sites, boundaries, compact point cohorts and district labels;
it does not load the full charging-points table in the browser. Rendering arrays are
transferred, geometry decoded to GeoJSON; the pipeline is not end-to-end zero-copy.
Map tiles are external CARTO/OpenStreetMap; MapLibre displays attribution.
For reproducible spatial indexing, scripts/prepare_district_index.py requires
pyarrow, shapely>=2, pyproj, numpy; arguments: --districts-original PATH,
--states-original PATH, --gpkg PATH (and optional --repo PATH).

## Validation and remaining work

Build, ESLint and 30 tests pass. Panel markup is checked separately.
Live layout/interaction should be verified locally. On small screens control scroll
is retained rather than clipping controls. Further transition tuning, chart/dashboard design and load optimization remain
separate steps.

## Step 12: nominal power and analytical territories

Apply this update to charging-points-state-navigation-step9. Extract the archive
into the project root and replace the included files, including BOTH Parquet files
in public/data. No npm dependencies have changed. Restart npm run dev after
replacement; run npm run lint, npm run build and node --test tests/*.test.mjs.

Terminology: charging_point_count = Ladepunkte (charging points); equipment_count
= Ladeeinrichtungen (charging installations); site = grouped charging location.
The site panel displays the first two counts as separate labeled rows.

installed_power_kw = sum of equipment_power_kw ONCE per distinct equipment_id.
The raw point table repeats that value at every point, so summing its rows would
overcount power. Do not multiply site maximum power by point count, or sum
alternative connectors. The preparation script validates finite, nonnegative
equipment powers, updates the site table and adds installed_power_kw and
equipment_count to the site/district index, using each installation's coordinates.
Both updated Parquet tables use ZSTD level 10.

kw_per_1000_bev = selected nominal installation power / registered passenger BEV
* 1000. National values use totals, not average state ratios. A zero BEV denominator
produces null. Nominal power includes all installations at selected sites, including
those under maintenance, matching the existing infrastructure-count semantics.
This is not measured simultaneous site output, live availability or vehicles/day;
shared site connections and vehicle charging limits can reduce actual power.
The browser only loads the compact site table and district index, never the full
point table for power aggregation. Power is recomputed with existing filters;
zoom/pan does not trigger power aggregation.

Regional panels display nominal power in MW and both normalized metrics; selecting
a state retains its summary until a district is clicked. Polygon fills, contours,
legend and tooltips share the chosen territory level and metric.

## Step 13: compact analytics summary

Apply after step12. Replace src/components/AnalyticsPanel.jsx, src/App.css and
README.md from the update archive; restart npm run dev. No data or dependencies
change. Regional codes remain in data but are omitted from the analytics panel.
Counters are ordered sites / installations / charging points, with explanatory
hover titles. Site details use the same order. Cluster summaries retain two
counts because their packet contains sites and points only.

Fleet and charging-infrastructure indicators are separate sections, including
the national overview. The current analytical metric is highlighted in place;
the duplicate headline card has been removed. Sections use two columns when
the scroll area's available width is at least 320px, otherwise one column.
The desktop panel is 400px wide; existing small-screen widths are retained.
Very narrow panels show counters as compact vertical rows to avoid overflow.
Long lists and small screens retain scrolling. Calculation notes are available
in the expandable footer, preserving space for the summary by default.

## Step 14: operator infrastructure shares

Apply after step13. Replace the included source files, stylesheet, README and
operator tests in the project root; restart npm run dev. Data and dependencies
are unchanged. The regional/national panel displays top five operators and Others,
with separate rankings by point count or nominal installation power. Changing
this local comparison does not change map metrics, filters or the camera.
The choice persists across territories during the session. Site/cluster detail
views retain their existing content; return to analytics for operator shares.

Names are normalized once when the Worker loads sites: NFC Unicode, trimmed and
collapsed whitespace, German lowercase matching. Display names retain spelling.
Different legal entities, subsidiaries and brand names are never inferred as
one corporate group. Blank names remain in the denominator as Operator unknown.
Shares describe registered infrastructure, not revenue, energy sold or sessions.

The Worker aggregates each operator across the filtered national selection,
states and equipment-assigned districts. National/state power counts installations
once via site totals; district power uses the existing equipment-derived index.
Each territory sends only top five plus Others for both bases and operator count;
full per-operator maps remain in the Worker. No new data fetch is introduced.
Zoom/pan does not recalculate shares. All installations and points at selected
sites count, matching current DC/power/24h filter semantics.

Checks: 30 existing tests plus three operator tests pass, ESLint and production
build pass, and panel SSR checks cover both comparison bases and empty results.
Actual responsive layout and interactions should be checked in the browser.
Concentration indicators (item 3), power distribution (item 5), and motorway
analysis (item 4) remain subsequent steps.

## Step 15: analytics detail tabs

Apply after step14: replace the three included files in the project root and
restart npm run dev. Data, dependencies and analytics calculations are unchanged.
Two mutually exclusive tabs follow the always-visible summary groups in the
national overview: statistics by states (default) and statistics by operators.
Only the active tab content is rendered. Tab choice and operator comparison basis
are stored in the persistent AnalyticsPanel, surviving filter/metric changes,
site/cluster details and regional selection. Returning to Germany restores the
last national tab. Selected state/district summaries show only the operator
section below their summary, without national tabs.

Tabs support ArrowLeft/ArrowRight/Home/End, roving focus, selected-state semantics
and a labeled tab panel. Long labels wrap; very narrow panels stack tab buttons.
Russian labels are retained during development; the final release is planned in
German (e.g. Statistik nach Bundesländern / Statistik nach Betreibern). Full
translation and final German layout review remain future work.

Validation: ESLint, production build and SSR checks for default/alternate tabs,
one visible panel, position below summary and regional-only operator content.
Visual behavior should be checked locally.

## Step 16: operator concentration

Apply after step15: replace the included source files, stylesheet, test and README
in the project root; restart npm run dev. No data or dependency changes.
The new Concentration operators map metric displays the largest operator's share
by point count or nominal installation power, using current site filters. The
comparison basis is shared by the left controls, operator section, state ranking,
map fill, legend and polygon tooltip. Changing it requires no Worker recalculation
or new fetch: both operator rankings are already available. Reset restores points.

Selecting a state defaults this metric to KBA districts, as with the other
analytical metrics; All Germany defaults to states. Manual territories remain
available. Orange = leader share strictly >60%, teal = <=60%, grey = no eligible
infrastructure or zero denominator. The descriptive threshold is defined once
in src/data/concentration.js. This is not a legal market dominance assessment,
a price assessment or a profitability prediction. Operator names remain separate
legal registry entities without inferred corporate ownership.

The operator section shows the leader, share, absolute value, denominator,
operator count and a threshold status. Small selections retain their actual share
and volume rather than hiding 100% from a single small installation. No-data
concentration is null, not 0%. HHI and power-distribution charts remain later work.

Validation: all 35 tests, ESLint and production build pass. New tests cover the
exact 60% boundary, both bases, zero totals, small selections, map colors and
ranking consistency. SSR checks cover status cards and legend. Browser appearance
and interactions should be checked locally.

## Step 17: return from a district to the selected state

Apply after step16; replace the three included files and restart npm run dev.
When a KBA district is selected within the state filter, All territories closes
the selected district and restores the selected state's analytics. The handler
clears only the clicked region and site/cluster detail; it does not change filters,
territory, analytical metric, operator basis, tab preference or camera view.
The state summary then offers All states, using the existing national-overview
handler. A district selected with All Germany offers All states directly.
Site/cluster/pending-detail return continues to use Back to analytics.

Validation: ESLint, production build and SSR checks for each return-button case.
No data, dependency or calculation changes.

## Step 18: point power distribution, point filters and selected territory

Apply after step17. Extract the update in the project root, replacing source files,
stylesheet, script, tests and README and adding the NEW required file
public/data/charging_point_groups_zstd10.parquet. Restart npm run dev. npm
dependencies and full source charging-point/site tables do not change.

This step supersedes historical whole-site counting descriptions in earlier steps.
Minimum power now selects points (>= threshold), while retaining each represented
site's existing geometry. DC requires that the SAME selected point has DC support.
24/7 still requires the whole site to be 24/7. Installation power is counted once
for installations with any eligible point, including its full reported capacity
regardless of how many points qualify; no unsupported allocation is made. All
regional ratios, operator shares, concentration, cluster counts and marker power
colors use this selection. Site details show selection and full-site totals.

The new compact ZSTD-10 Parquet groups points by installation, maximum point
power and DC flag, retaining district assignment from original equipment
coordinates. 122,896 cohorts represent all 208,570 accepted points and 116,108
installations. Its size is about 1.6 MiB, replacing the old district-index fetch
in the browser. The Worker converts it to typed arrays and aggregates by filter;
the full point table is not downloaded. Cohorts preserve exact power thresholds
beyond the four display categories.

Distribution after the summary and before tabs: <=22, >22 and <50, >=50 and <150,
and >=150 kW, counted per point using maximum connector power once per point.
Counts and percentages use eligible points for Germany, states and KBA districts.
Unknown/invalid powers fail preparation rather than silently becoming zero.

Selected state/district gets a separate blue 3px outline, without changing
analytical fills, picking or camera. The outline respects boundary visibility,
updates with selection and disappears on returning to the previous level.

Validation: all 39 tests, ESLint and production build pass. New tests compare
cohort results against raw point records under power/DC/state/24h/empty filters,
verify full installation power is counted once, band boundaries and highlight
visibility. SSR checks cover distribution and selected versus whole-site labels.
Visual interaction should be verified locally.

## Step 19: return navigation and compact power distribution

Apply after the pushed step18. Replace the eight included files in the project
root and restart npm run dev. No data, dependency or calculation changes.
Back to analytics smoothly fits the region whose analytics is restored, but
only when the state dropdown has a manually selected state. If the retained
selection is a KBA district in that state it fits the district; otherwise it
fits the state. All territories fits the selected state and clears district
selection. All states fits Germany when leaving that manually selected state.
With All Germany already selected, closing site/cluster details or clearing a
clicked region keeps the existing camera. Internal cleanup on filters, retry
and reset does not invoke the new return-to-analytics navigation handler.
Existing fitBounds, panel padding and 280ms transitions are reused; no additional
spatial query or network fetch is added.

The point-power distribution is initially collapsed. Its heading is a keyboard
accessible button with expanded-state and controlled-content semantics. Its
open state is stored in AnalyticsPanel and survives filter/territory changes
and site/cluster views. The selected territory outline uses the exact ordinary
boundary color [180,205,199,180], retaining a 3px width and boundary visibility
behavior. Clicking summary metric rows remains a possible later improvement.

Validation: ESLint and production build pass. Seven relevant navigation/layer
tests pass, including new manual-state-only return-target cases. SSR checks cover
open/collapsed distribution and matching selected/ordinary contour colors.
Check camera transitions and panel appearance locally.

## Step20 — parallel startup and loading measurements

Initial loading now starts Parquet WASM, sites, point cohorts, both territory
files and district labels concurrently. Site markers are still published before
territory geometry. A regional download failure leaves the sites usable.

The initial Worker request includes the current selection. React compares the
four selection values before sending another filter request: reaching `ready`
with the same selection no longer recalculates analytics and rebuilds the cluster
index. A selection changed during loading is submitted when the Worker becomes
ready. Display controls do not enter this comparison. Reload starts a fresh
request sequence and retains the current selection.

The browser console contains two `[Charging performance]` reports:
`Площадки готовы` and `Территории и аналитика готовы`. Tables show fetch/read,
WASM initialization, Parquet decoding, point/operator indexing, selection and
analytics, cluster indexing and geometry preparation. The headline includes
Worker elapsed time and elapsed time since the main thread started loading.
These are data-ready/message receipt timings, not a measurement of completed
screen painting. Fetch/read durations can include scheduling waits in a busy
Worker; use Network/HAR for actual network timings. Concurrent stages overlap,
so do not sum the rows to obtain total loading time.

For comparison with step19, run `npm run build` and `npm run preview`, keep the
same initial camera and selection, disable browser cache and reload three times.
Record the two console reports alongside Network statistics. Inspect warm-cache
loading separately. HTTP compression of WASM is not changed by this update:
that must be checked on the deployment host.

Apply after step19: replace README.md, src/hooks/useChargingData.js and
src/workers/charging.worker.js; add src/data/filterKey.js and
tests/loading.test.mjs. No dependency or data updates. Checks:
`npm run lint`, `npm run build`, `node --test tests/*.test.mjs`.
The loading tests exercise the real Worker processing pipeline using a Node
Parquet decoder and controlled transport, including early regional failure.

## Step21 — faster indices and deferred territory decoding

Identical source operator names are normalized once per initial index build.
Case/spacing/NFC normalization, first display name, unknown-operator handling
and separation of legal entities are preserved. The cache is local to the build.

Point groups and operators now read the current Arrow RecordBatch directly,
avoiding repeated chunk lookup for every value in a multi-batch Vector. All site
and equipment IDs remain strings and district codes retain leading zeros.

All initial downloads still start together. Downloading territory bytes no
longer triggers Parquet/Arrow decoding immediately: that processing starts after
the site-ready message. Sites and point groups are decoded first. Regions still
receive the current selection statistics, including filters changed while their
requests are outstanding. A failed region request leaves sites available.

Parquet reader batchSize is now 16384 instead of the library default of 1024.
This reduces the number of Arrow batches and IPC bookkeeping without changing
files, schemas or row selection. Full and final partial batches are retained.
No new dependencies, additional Workers or data replacement are required.

Console fetch labels now say `Получение байтов (с ожиданием Worker)` rather than
`Скачивание`: the measured interval includes completion scheduling in the Worker
and must not be interpreted as pure network transfer time. Territory decoding
appears in the second performance report, after `Площадки готовы`.

A three-round local Node comparison on identical default-sized Arrow batches
produced operator indexing times of 218–226 ms before and 55–57 ms after;
point-group indexing took 250–271 ms before and 194–226 ms after. Full index
outputs matched exactly. These are local processing measurements, not promised
browser startup times. Cold/warm browser measurements remain separate.

Apply after step20: replace the six files included in the archive, then run
`npm run build` and `npm run preview`. Repeat the same three cold-cache reloads
and compare both `[Charging performance]` reports. Checks:
`npm run lint`, `npm run build`, `node --test tests/*.test.mjs` (44 tests).
Coverage includes multi-batch/sliced operator vectors, deferred territory
processing, regional failure and conservation of all 208570 points, 116108
installations and 9067843.9 kW through the actual Worker pipeline.

## Step22 — decode only the site columns consumed by the app

The site Parquet file has 30 columns. The map, filters, analytics and complete
site card consume 21. Their shared list lives in src/config/siteColumns.js;
site detail fields use that same list, so changing a detail field cannot silently
omit it from projection.

In installed parquet-wasm 0.6.1, the synchronous readParquet columns option did
not actually project columns in the checks. The projected site reader therefore
uses ParquetFile.fromFile on the already downloaded bytes and its stream API.
Each streamed RecordBatch is converted with its own projected schema and all
batches are joined into an Arrow Table. The last partial batch is retained.
It validates the requested columns against the file schema before streaming,
retains schemas for empty files and releases the stream/file handles.

Point cohorts and territories keep the step21 reader. Initial request order and
site-before-territory priority are preserved. The site decoding report now says
`Декодирование выбранных колонок: площадки`; its duration includes asynchronous
in-memory reading and conversion. Network payload size is unchanged: projection
happens after downloading the original file. No Parquet files, dependencies or
WASM delivery settings are replaced by this update.

A local Node comparison produced 25,244,280 bytes of intermediate IPC for full
site reading and 17,410,784 bytes for the selected-column stream (about 31% less).
That is IPC volume, not a measurement of total browser peak memory. In two warm
comparison rounds, full decoding took 94–95 ms and projected streaming took
64–73 ms before adding the explicit schema validation. Browser effects must be
measured independently; cold runtime compilation can dominate the first decode.

Apply after step21: replace README.md, src/workers/charging.worker.js and
tests/loading.test.mjs; add src/config/siteColumns.js,
src/data/readProjectedTable.js and tests/projection.test.mjs. Then run
`npm run build` and `npm run preview` and compare the same three cold reloads
and both console performance reports.

Checks: `npm run lint`, `npm run build`, `node --test tests/*.test.mjs` (47 tests).
Projection tests compare every value and type of all 21 retained columns against
full decoding, all index outputs, map buffers, regional/operator/power statistics
under combined and empty selections, final partial batches and empty schemas.
The real Worker test also requests the final site's detail card.
