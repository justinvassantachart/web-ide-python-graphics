# 0.3.0-images.1 starter correction

Supersedes images.0 for staging. The Sand starter now paints each press/drag event
before processing a following release, so quick clicks cannot disappear between
frames. The shared image implementation and wire protocol are unchanged. The
consumer now includes the actual Sand/Waterfall/Baby Graphics starter sources;
`IMAGE_BENCHMARK=brush` checks quick Sand and BigErase clicks against displayed
pixels; Chromium, Firefox and WebKit all pass both clicks. Images.0 remains immutable; its library, engine and browser evidence
below still applies to the unchanged runtime code.

# 0.3 image and course graphics candidate verification (2026-11-10)

The candidate composes Web IDE 0.11.0-images.0 and debugger-sh
0.3.15-webide.0.9.0.2. `npm run validate` passes 100 TypeScript tests, 24 CPython
tests, lint, typecheck, build, a real CPython/multiplexer image/save/reload check,
and actual production worker isolation checks. The deliberate UI-entry negative
control fails compilation, as required. A clean packed consumer passes both
Bundler and strict NodeNext declarations and its production build.

The real browser fixture uses binary PNG/JPEG files in the guest filesystem,
real WASM CPython and browser codecs. Chromium 151.0.7922.34, Firefox 153.0 and
WebKit 26.5 all passed Run and Debug→Continue, exact opaque PNG chromakey pixels,
JPEG decode, PNG/JPEG guest saves, PNG reload, retained image sprites and PNG
download after normal exit. All three also passed native text Return, button,
checkbox/slider/radio defaults and changes, no control typing leaking into canvas
keys, and captured pointer release outside the canvas.

The independent implementation audit's regressions cover immediate pins inside
frame batches, rollback of partial pin acquisition, superseded upload owners,
queued GC release without destructor I/O, save commit retry and unconditional
encoded-transfer release, normal guest paths, bounded repr, and temporary decode
release when the guest pixel budget rejects. An actual Chromium run performed
100 edits/saves at 800×600, reloaded the absolute guest path, discarded 300 uploaded
images, and rendered two differently colored immutable revisions in one batch;
all passed in 68.445 seconds. Stop during the full Ghost loop acknowledged in 28 ms
and settled in 32 ms on the development host.

THS's separate integration tests additionally verify generation-fenced immutable
binary maps and hashes, resource-before-scene ordering, scene-before-release
ordering, a 128 MiB partition (80 MiB worker/48 MiB page), queued structured-clone
reservations held until explicit page receipt, and recoverable page/worker budget
failures that preserve downloads. Only pinned displayed frames cross the worker;
temporary decoded guest working images do not.

## Performance evidence and limits

Measured on Intel Core i7-8850H 2.60 GHz, 16 GiB macOS development hardware using
Chromium. These are real rendered frames, counted after canvas paint on animation
frames, not merely guest loop iterations. The full Ghost workload uses nine
1000×750 images (6.75 million input pixels), local tuple APIs and nearest-to-average
RGB. Integer squared-distance selection preserves the nearest-pixel result.

| Workload | Measurement |
| --- | --- |
| Ghost optimized initial sample | 83.244 s total; 80.382 s algorithm; 2.318 s load |
| Ghost separate five-run series | 105.688 s cold/busy; 82.360, 88.942, 81.640, 83.663 s warm |
| Sand 50×50, 60 seconds | 48.87 presented FPS; 33.335 ms p95 presentation interval |
| Sand 100×50, 60 seconds | 34.17 presented FPS; 49.995 ms p95 presentation interval |

Initial unoptimized Ghost implementations took 165.245 s and 203.003 s total; initial
per-pixel Sand paths missed the frame target. Compact `set_rgb_data` and the
allocation-free tuple getter resolved these measured bottlenecks. The cold/busy
Ghost sample still exceeds 90 seconds. Five warm samples per workload and school
hardware qualification are **not yet complete**; these observations do not claim
a general 90 second p95 guarantee or a production-wide performance qualification.
Raw reports are retained with the implementation artifacts under
`python-browser-matrix`, `python-audit-controls`, `python-audit-lifetimes`,
`python-stop-evidence`, `python-ghost-warm-evidence`, and `python-sand-bulk-evidence`.

Reproduce against a retained packed consumer with `scripts/browser-images.mjs`.
Set `IMAGE_FIXTURE_URL`, `PLAYWRIGHT_MODULE` when Playwright lives outside this
package, and `IMAGE_EVIDENCE_DIR`. `IMAGE_BROWSERS=chromium,firefox,webkit` runs the
codec/debug matrix; `IMAGE_CYCLES=20` repeats run/reset. `IMAGE_BENCHMARK` accepts
`controls`, `lifetimes`, `ghost`, `sand`, or `stop`; `IMAGE_RUNS` repeats benchmarks.
The Sand harness measures each requested width for 60 seconds.

Earlier release evidence follows and applies to those historical packages only.

---

# 0.2.1 worker entry verification (2026-11-05)

The production public-player build demonstrated that importing headless names
from the root UI entry can retain React CommonJS initialization in a worker.
Version 0.2.1 adds `@web-ide/python-graphics/core` and separates its source-map
and measurement-type dependencies from UI declarations. Graphics behavior and
the transport/Python contracts are unchanged; the 0.2.0 release is immutable.

`npm run validate` passed lint, typecheck, all **88 TypeScript tests**, all
**12 CPython tests**, the library build and the real neutral transport check.
The added `check:worker` compiles actual Vite module workers retaining all
exports from `/core` and `/transport`, rejecting retained React, DOM and editor
code. Its root-UI negative control fails as required.

A fresh clean consumer installed the exact 0.2.1 archive (SHA-256
`36748f2cd003ec4efb561ad3e1c23341382bf3349fd0e1ff143f156303925a88`)
and released Web IDE 0.10.0. Both bundler and strict NodeNext declarations passed,
and the production application compiled a 54.85 kB module worker using the
public `/core` controller, source map, validators and types. The same retained
module/code guard passed for that packed consumer.

The built consumer was served with COOP/COEP on localhost:4310 and exercised in
Chromium **151.0.7922.34**. An actual worker created/reset a controller, parsed
its snapshot and keyboard input, returned status and the three Python resource
paths, and terminated successfully. The main-thread UI then executed the real
Python shapes program and rendered all eight objects and text. Both checks
passed with **zero page or console errors**. This focused browser check covers
the packaging change; the full graphics matrix below was not repeated for
0.2.1. Evidence is retained outside the repository at
`/tmp/graphics-transport-artifacts/browser-worker-core-0.2.1.json`, the matching
screenshot, `/tmp/graphics-worker-core-browser-qa.mjs`, and the clean consumer
at `/tmp/graphics-worker-core-consumer/app`. Downstream THS production isolation
and deployment validation remain the consuming application's responsibility.

---

# 0.2 neutral transport verification (2026-11-04)

The 0.2 validation path includes TypeScript tests for framing, global request
ownership, throwing services, deadlines, cancellation, stale callbacks and
teardown; CPython tests for shared descriptor/handshake/IDs, partial I/O, strict
response validation, graphics/independent-service ordering, Canvas closure and
aggregate budgets; and a real CPython process exchanging partial byte chunks
with the built TypeScript neutral transport and two independent services. The
last check asserts that the guest never imports graphics.

`npm run validate` passes lint, typecheck, 88 TypeScript tests, 12 CPython tests,
the library build, and the real TypeScript/CPython transport check.
`WEB_IDE_TARBALL=... npm run check:consumer` installs exact archives into a clean
application and checks bundler/NodeNext declarations and a production build.
`GraphicsController.reset()` and strict cross-worker snapshot/input parsers have
focused regressions. The 0.2 consumer `multi` program uses public capability
clients before and after Canvas creation and after Canvas.close; private
`Canvas._conn` access has been removed.

## Fresh 0.2 packed-consumer browser matrix

Chromium **151.0.7922.34**, Playwright, macOS, viewport 1400×900 plus 760×640.
The clean production consumer installed the exact 0.2 archive (SHA-256
`df08565fce6bfabe740c17949ddaf644cacd6a7a1b22931f667004fa91add4d1`)
and released Web IDE 0.10.0. Vite preview on localhost:4310 supplied COOP/COEP;
`crossOriginIsolated` was asserted for every scenario. Programs executed through
the real stock Python WASM runtime; no source aliases or mocked guest messages.

| Scenario | Result |
| --- | --- |
| Shapes, text, z-order, execution-only resources hidden | PASS: 8 objects, correct back-layer rectangle and text |
| Mutation, live measured bounds, visibility, deletion | PASS: moved coordinates, text, recolor and deleted-handle errors |
| Independent service before/after graphics and after Canvas.close | PASS: all 3 public-client replies, one graphics text object, exit 0 |
| Scaled pointer coordinates and keyboard focus | PASS: 760×640 viewport maps to click (100,80); `a`, ArrowLeft, `q` delivered while focused |
| Animation, Stop, frozen frame, rerun, panel switching | PASS: moving ball; frozen after Stop; one ball after rerun; Variables/Graphics switching preserves state |
| Python error recovery and unsafe paint rejection | PASS: unsafe colors/invalid style rejected; traceback exit 1 retains valid object |
| Turtle adapter | PASS: 120 rebeccapurple line segments, exit 0 |
| Neither service; host without graphics | PASS: no blank canvas; plain host imports fail cleanly while Python continues |
| Two simultaneous IDE instances | PASS: independent 8-object scene and one animating ball |
| Tiny/tall/4096² canvases, narrow panel, light theme, opacity | PASS: fit within viewport; eight objects retain opacity 0.4 |
| Debug entry, step over, continue | PASS: debugger pauses/steps; continuation produces 8 objects, exit 0 |
| Paint drag and keyboard color switch | PASS: crimson segments follow drag; Stop completes |

All **12 scenarios passed**, with **zero page errors or console errors**. Two
initial harness assertions used HTMLElement.innerText on SVG; changing those
assertions to textContent and rerunning only those two cases resolved them.
No product change was needed for that harness correction. External evidence is
`/tmp/graphics-transport-artifacts/browser-report-final.json`, the sibling
`browser-*.png` screenshots, and `/tmp/graphics-consumer-browser-qa.mjs`. The
consumer remains at `/tmp/graphics-transport-final-consumer/app` for replay.

The default plugin also has focused lifecycle regressions for deactivation
while a guest waits for input, fresh-controller reactivation, and idle teardown.
Manual mux compositions must supply the required `onFatal` stop callback.

This package-local work does not claim deployed THS verification. THS must
verify its own editor/public-player integration, live authorization and production
asset hosting. Safari/WebKit and Firefox were not exercised in this package
matrix. The older records below remain **0.1 historical evidence**.

---

# Verification record — @web-ide/python-graphics

Scope of this run and exactly what was and was not verified, per the repository's
handoff checklist (`docs/testing.md`).

## Baseline

- Web IDE commit: `0f36dab` (branch `codex/python-graphics-companion`), verified
  equal to the stated `0f36dab8d4b00c7a9592acfe9704d19a6cc5698e`.
- Web IDE `0.10.0`; engine `debugger-sh@0.3.15-webide.0.9.0.1`.
- Toolchain: Node 24.22.1, npm 11.19.1, TypeScript 5.9.3, Vite 7.3.7,
  Vitest 4.1.12, React 19.2.8. Local Python 3.9.6 (host-side QA only; the guest
  runtime is the engine's CPython 3.11.3, exercised via protocol parity here).
- Companion package: `@web-ide/python-graphics@0.1.0`, built to a single
  `dist/index.js` (~64 kB) plus per-module declarations; Python helper inlined.

## Commands run

| Command | Result |
| --- | --- |
| Companion `eslint .` | PASS |
| Companion `tsc -p tsconfig.json --noEmit` | PASS |
| Companion `vitest run` (48 tests: protocol, model, color, service, mux, renderer) | PASS |
| Companion `vite build` | PASS |
| Python helper `ast.parse` (both modules) | PASS |
| Cross-language framing agreement (Python frame ⇄ TS reader, both directions) | PASS |
| Python client ⇄ TS host end-to-end (real example programs → captured commands → host) | PASS (0 commands dropped) |
| Client-subset validation property (width<0, font_size≤0, UTF-16 text length) | PASS |
| Packed clean-consumer: pack web-ide + companion, clean `npm install` of both tarballs, bundler `tsc`, **strict NodeNext `tsc` of the installed declaration graph**, `vite build` | PASS |
| Web IDE root `eslint .` (after adding `packages/**` and `.qa/**` ignores) | PASS |
| Web IDE root `tsc -b` | PASS |
| Web IDE `vitest run` (full suite) | PASS at baseline (re-confirmed; web-ide source unchanged) |
| Live real-Python in-browser QA against the **packed** candidate (Chromium via Playwright; matrix below) | **PASS** (15 scenarios, 0 IDE/companion console errors) |
| `npm run test:browser` (web-ide's own Playwright suite) | NOT RUN — web-ide source is unchanged; the companion is exercised by the matrix below |

## Live browser QA (real engine, packed candidate)

Environment: Chromium (Playwright 1.64/1.65 alpha via the Kiro Playwright MCP
browser, which runs outside the agent's network sandbox), viewport 1400×900 and
760×640 (narrow). Target: the packed clean-consumer app (`web-ide-0.10.0.tgz` +
`web-ide-python-graphics-0.1.0.tgz` installed by bare name), production
`vite build` served by `vite preview` with COOP/COEP headers;
`window.crossOriginIsolated === true`, `SharedArrayBuffer` available. Runtime:
real debugger-sh WASM CPython 3.11.3 (assets fetched from runno.dev, all 200).
Monaco 0.56.0 from jsDelivr. Screenshots: `.qa/screens/browser-*.png` (external
review artifacts, not committed).

| # | Scenario | Steps | Expected / actual |
| --- | --- | --- | --- |
| 1 | Shapes + text + layering (`shapes.py`) | Run | All 8 objects rendered in SVG; `to_back()` rect behind coral; centered text; terminal `shapes drawn`, exit 0. **PASS** |
| 2 | Mutation / bounds / visibility / delete | Run `mutation` | `a.get_bounds()` 40,40 → after `move(120,20)` 160,60; **live text `getBBox` w=34.03 h=14** round-tripped to Python; hidden omitted; deleted handle raises; `to_front()` → last in DOM. **PASS** |
| 3 | Mouse clicks + keyboard (1:1 canvas) | Run `events`; click (100,80),(300,200); keys `a`,`ArrowLeft`,`q` | Terminal `click 100 80`, `click 300 200`, `key a`, `key ArrowLeft`, `key q`, `done`; circles at click points; exit 0. **PASS** |
| 4 | **Scaled coordinates** (narrow 760×640) | Same, canvas rendered 390.5×300 (letterboxed) | Python received `(100, 76.35)` / `(380, 286.35)` = exactly the browser's own inverse-CTM mapping (letterbox offset 3.56px); circles under the pointer. `get_event(timeout=25)` → `timeout`, clean exit. **PASS** |
| 5 | Animation (`bounce.py`, host-timed `pause(16)`) | Run | Ball position changes continuously (64,35 → 84,86 in 500 ms). **PASS** |
| 6 | **Stop mid-run → rerun** | Stop during animation; Run again; Stop | Final frame frozen (unchanged 600 ms after Stop), Ready, exit 0; rerun resets to exactly one ball and animates again; second Stop clean. **PASS** |
| 7 | Error recovery + injection rejection | Run `error` | `fill="url(javascript:alert(1))"`, `font_size=0`, `width=-2` each raise `GraphicsError` client-side (no `url(` ever reaches the DOM); uncaught `ValueError` → Python traceback, exit 1, prior drawing retained, IDE back to Ready. **PASS** |
| 8 | **Graphics + independent second service on one device** (`service=multi`) | Run `multi` | Channel-2 mock "clock" request answered `{'id':7,'ok':True,'result':{'now':1234}}`; graphics continues after it (2 shapes + text). **PASS** |
| 9 | Unknown channel is recoverable (graphics-only composition) | Run `multi` | Host control `error: Unknown channel 2` → clean `GraphicsError`; graphics keeps working; exit 0. **PASS** |
| 10 | **Two simultaneous IDE instances** | `instances=2`; Run both | Left: 480×320 white, 8 shapes, exit 0. Right: 400×300 dark, 1 animating ball, Running. No cross-talk; independent toolbars/terminals. **PASS** |
| 11 | **Debug** | Debug `shapes.py`; Step Over ×3; Continue | Paused at line 4 (canvas not yet created, 0 shapes); after stepping lines 4→6→7 the canvas exists and exactly skyblue rect then gold oval appear; Continue → 8 shapes, exit 0, debug toolbar gone. **PASS** |
| 12 | **Host without graphics** (`host=plain`) | Run `noimport` | No Graphics tab (panels: Variables only); `import graphics` → `ModuleNotFoundError`; program continues, exit 0 — Web IDE unaffected by the companion's absence. **PASS** |
| 13 | Execution-only resource hidden | Inspect explorer | Only `main.py` in the tree; no `graphics` entry. **PASS** |
| 14 | Paint: drag + keyboard color switch | `r`, 5-point drag, `g`, 5-point drag | 4 crimson + 4 seagreen segments, width 3. **PASS** |
| 15 | Turtle-style adapter | Run `turtle_spiral.py` | 120 rebeccapurple segments, exit 0. **PASS** |
| 16 | Themed panel (post-review fix) | Rebuilt packed consumer; Run `shapes.py` in the light workbench | Panel chrome follows `--color-chrome` (light), hint uses `--color-muted-foreground`; scene renders identically; 0 console messages. **PASS** |

Console across the whole session: **no errors or warnings from Web IDE or the
companion** (the only entry was a `favicon.ico` 404 from the scratch QA page,
since fixed). Network: every runtime asset request succeeded.

### UI audit (Chromium, packed candidate; `.qa/screens/audit-*.png`)

| Check | Result |
| --- | --- |
| Light and dark workbench themes | Panel chrome, hint color and focus ring follow `--color-chrome`, `--color-muted-foreground`, `--color-ring`. **PASS** |
| Panel width 20% and 57%, viewport 1400×900 and 760×640 | Canvas scales to fit (`max-width/height: 100%`), centered, letterboxed with correct pointer mapping; no scrollbars/overflow. **PASS** |
| Tall canvas 300×1200 | Scaled to panel height (808 px), no overflow. **PASS** |
| Huge canvas 4096×4096 (the limit) | Scaled to 0.188×, text legible, no overflow. **PASS** |
| Tiny canvas 120×80 | Rendered 1:1 (not upscaled; pixel-faithful for teaching), centered. **PASS** |
| Text anchors vs `get_bounds()` | All 9 anchors' Python-reported bounds match the browser's `getBBox()` within 1.5 px. **PASS** |
| Opacity / palette | Correct alpha compositing over the canvas background. **PASS** |
| Empty states | **Fixed during audit**: the hint used to overlap an empty default canvas (unreadable across white/dark); a program that drew nothing left a blank white rectangle. Now: never-run → hint only; running-but-not-yet-drawn → "Waiting…"; ended without drawing → "finished without drawing anything"; canvas appears only once the program issues a graphics command. **PASS** |
| Keyboard focus indicator (a11y) | **Fixed during audit**: the focusable canvas had `outline: none` with no replacement, so keyboard users could not see focus. Now a 2 px `--color-ring` ring on `:focus-visible` (keyboard), none for pointer focus — verified via Tab navigation (`boxShadow: rgb(0,95,184) 0 0 0 2px`). **PASS** |

Not run: web-ide's own `npm run test:browser` suite (unchanged web-ide source;
re-run before a release that bumps web-ide) and `validate:production`.

## Additional evidence

- **Protocol/model/service/mux contract tests** (committed, 42) plus a **jsdom
  renderer smoke** (committed, 6) covering shape/text/anchor/visibility/z-order
  rendering, HTML escaping, and pointer→logical **scaled-coordinate** mapping with
  click/drag/key synthesis.
- **Cross-language wire agreement**: the real Python helper's framing + JSON and
  the TS `FrameReader`/codec parse each other's frames byte-for-byte.
- **Real client ⇄ real host E2E**: the actual example programs run against an
  in-memory protocol host (exercising the real client's framing, validation,
  handshake, blocking reads, request/response), and every command they emit
  (shapes 10, bounce 63, paint 7, turtle 121) is accepted by the real
  `GraphicsService` with **zero silent drops**.
- **Faithful visual output**: the real `SvgCanvas` component server-rendered from
  scenes the real service produced, at `.qa/screens/*.svg` (shapes, text anchors,
  mutation+layering, paint, palette+opacity, bounce, turtle spiral) and
  `.qa/screens/e2e_*.svg` (rendered from the captured real-program command
  streams). These are external review artifacts, not committed.
- **Packed clean-consumer**: both tarballs install into a fresh app with a single
  React tree and a successful production build — no source alias, no sibling repo.

## Not claimed

- Browser support is demonstrated for **Chromium only** (the browser exercised
  above). Firefox/Safari were not run.
- No full Tkinter/Pygame/Stanford/turtle parity; only the documented core API and
  a turtle-*style* adapter.
- There is no image API in v1 (documented follow-up).

## Reproduce the live QA

1. `npm ci && npm run validate` (lint, types, unit, build).
2. `node consumer-check/run.mjs` (packs both tarballs, installs, builds), or build
   the consumer in place and serve its `dist` with `vite preview` (COOP/COEP
   headers are configured in `consumer-check/app/vite.config.ts`).
3. With Chromium and network access to jsDelivr (Monaco) and runno.dev (Python
   WASM), open `/?program=<shapes|bounce|paint|turtle|hello>` plus
   `&service=multi`, `&instances=2`, or `&host=plain`, and drive the Graphics
   panel as in the table above.

## Cloud verification

2026-11-03 — Handoff-host run on macOS 15.7.3 (24G419, x86_64), Node
24.19.0 / npm 11.17.0, Chromium 151.0.7922.34 via Playwright 1.63.0. A fresh
packed consumer against the exact `web-ide-v0.10.0` release asset passed all
16 browser scenarios and the UI audit (24 cases in one uninterrupted run),
including 760×640 scaled input, stop/rerun, shared services, two IDEs, debug
stepping, light/dark themes, empty states, focus rings, canvas sizing, text
anchors, and opacity. Every page was cross-origin isolated; real CPython
3.11.3 WASM and Monaco loaded successfully. Result: PASS, zero console messages,
uncaught page errors, failed requests, or HTTP errors. Standalone validation
(49 tests), the 23-file package check, packed consumer checks under bundler and
strict NodeNext resolution, and initial GitHub CI also passed. Screenshots and
QA scripts remain outside the repository. Empty-state checks used `hello`
(no graphics commands); `nodraw` explicitly creates a Canvas and correctly
displays an interactive canvas with zero objects.
