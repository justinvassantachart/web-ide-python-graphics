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
| Packed clean-consumer: pack web-ide + companion, clean `npm install` of both tarballs, `tsc`, `vite build` | PASS |
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

Console across the whole session: **no errors or warnings from Web IDE or the
companion** (the only entry was a `favicon.ico` 404 from the scratch QA page,
since fixed). Network: every runtime asset request succeeded.

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

1. `cd packages/python-graphics && npm run validate` (lint, types, unit, build).
2. `node consumer-check/run.mjs` (packs both tarballs, installs, builds), or build
   the consumer in place and serve its `dist` with `vite preview` (COOP/COEP
   headers are configured in `consumer-check/app/vite.config.ts`).
3. With Chromium and network access to jsDelivr (Monaco) and runno.dev (Python
   WASM), open `/?program=<shapes|bounce|paint|turtle|hello>` plus
   `&service=multi`, `&instances=2`, or `&host=plain`, and drive the Graphics
   panel as in the table above.
