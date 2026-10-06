# Step26: diagnostic comparison after step25

Apply this small archive over the committed step25 on dev. It adds only a
standalone diagnostic page, benchmark scripts and the audit snapshot of
runtimeIndexes.js from step24 commit f8da0fa. Application behavior, data files
and the normal production bundle are unchanged. No dependency changes.

## Browser

```sh
npm run dev
```

Open the URL printed by Vite with runtime-comparison.html after the base path,
usually http://localhost:5173/charging-points/runtime-comparison.html.
Close tabs displaying the map, click Запустить сравнение, and leave the page
foreground until complete. Send the median table and the JSON results below it.
One run performs six alternating comparisons: 12 new Workers, each with its
own JavaScript realm. Each Worker decodes either the original 21-column browser
sites or the 5-column startup sites, then the identical numeric groups/catalog.
Step24 uses the original attachment implementation and browser-site hash;
step25 uses the current implementation and startup-site hash. Both use the
same unchanged selection/analytics function. Nothing is mocked in decoding or
analytics. The map/GPU/basemap is absent to isolate processing. Network, initial
WASM initialization and SHA-256 are outside reported processing times. Function
first-call timings and medians of three later calls are reported separately.
Selection results are compared by SHA-256, including typed arrays and statistics.
The browser may still cache compiled WASM across Workers; this is not a simulation
of 12 fresh browser processes or a measurement of end-to-end site startup.

This page is intended for the dev server; npm run preview of the normal app build
does not include the diagnostic entry point. The diagnostic HTML and its Worker
also passed a separate Vite production compilation during preparation.
Browser execution still needs to be checked in the target browser.

## Node

```sh
node scripts/benchmark_runtime_regression.mjs
```

Runs the same comparison using parquet-wasm/node. Fresh Workers, sequential
execution and alternating order avoid warming one version in the other's realm.
The full JSON is printed after the table. First calls can still include lazy
JIT optimization and garbage collection; later calls are not directly comparable
to cold first-load numbers from the map. Node results do not prove browser behavior.

## Findings in the preparation environment

The numeric groups file is byte-identical across steps24/25, SHA-256:
d009848ee3be5f9fe4b4383cbed1af707c6f4312fe345aecc212602b3822f1f2.
pointSelection.js is also unchanged. Attachment added the three generation-link
checks for the startup file; its dense-array validation loop is unchanged.

Two six-pair Node series returned identical selection hashes. Across those
series, medians of first calls were:

| Processing, ms | step24 | step25 |
| --- | ---: | ---: |
| Attach indexes | 34.5–35 | 40.5–41 |
| Analytics | 176.5–181.5 | 166.5–175 |
| Repeated attachment | 16–16.5 | 16–18 |
| Repeated analytics | 146.5–151 | 138–138.5 |

The multiple-fold slowdown observed in the user's step25 browser measurements
was not reproduced in Node. Its browser cause remains unestablished; runtime
warming, CPU contention, allocations/GC and browser/WASM behavior are hypotheses,
not findings. No speculative production optimization was applied.

Validation: portable Node benchmark completed all 12 Workers with equal results;
ESLint and the normal production build passed. The application bundle hashes
remain those of step25. The diagnostic browser entry was separately compiled.
