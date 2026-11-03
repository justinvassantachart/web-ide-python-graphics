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
| `npm run test:browser` (Playwright, production bundle) | **NOT RUN** — see blocker |
| Live real-Python in-browser E2E against the packaged candidate | **NOT RUN** — see blocker |

## Environment blocker (reported, not worked around)

This environment cannot run a live browser E2E of the full IDE:

1. **No launchable browser.** No Playwright Chromium is installed and the browser
   download host is unreachable; launching system Google Chrome fails under the
   OS sandbox.
2. **Asset CDN blocked.** Outbound egress is allowlisted to the npm registry and
   GitHub (so dependency install works), but general internet and
   `cdn.jsdelivr.net` are blocked. Web IDE loads Monaco and the Python WASM
   toolchain from jsDelivr at runtime, so the in-browser runtime cannot become
   ready here regardless of the browser issue.

Consequence: the real Python program cannot be executed in a real browser in this
environment, and `npm run test:browser` / `npm run validate:production` cannot
complete here. The byte-device transport and Monaco/runtime UI are Web IDE's
already-tested surface; what the companion adds is covered by the evidence below.

## Evidence delivered in place of the live E2E

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

- No browser compatibility is claimed from execution (none was possible here).
- No full Tkinter/Pygame/Stanford/turtle parity; only the documented core API and
  a turtle-*style* adapter.
- Images are unsupported in v1 (documented follow-up).

## Reproduce the live E2E where a browser + CDN are available

1. `cd packages/python-graphics && npm run validate` (lint, types, unit, build).
2. From repo root with Chromium installed and jsDelivr reachable, build the packed
   consumer (`node .qa/packed-consumer.mjs`) and serve `.qa/consumer` with
   `vite preview` (COOP/COEP headers already configured), then drive the Graphics
   panel: Run `shapes`, assert the SVG shapes/text; `paint`, assert click/drag
   draws at scaled coordinates; stop/rerun; two instances isolated; `host=plain`
   runs without a Graphics tab; `service=multi` coexists.
