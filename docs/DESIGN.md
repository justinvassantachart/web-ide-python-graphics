# @web-ide/python-graphics — design & wire contract (draft for review)

Status: **reviewed draft** (two independent design reviews applied; see §0). Target: Web IDE `0.10.0` @ `0f36dab`, engine `debugger-sh@0.3.15-webide.0.9.0.1`.

## 0. Normative invariants (binding, from design review)

These rules are **MUST**s. They make blocking I/O over the shared device provably
deadlock-free and close the trust-boundary holes found in review.

1. **Response-only host→guest, single outstanding request.** Every byte the host
   writes to the guest is *the one response* to a prior guest **request**. The host
   never pushes unsolicited frames. The guest keeps **at most one request outstanding
   at a time** (it is single-threaded and synchronous), then blocks reading until that
   response arrives. Commands (no `id`) get no response. Injected services (§6) MUST
   obey the same request/response discipline — no push. Consequence: the next
   host→guest frame is always the awaited response, so there is no cyclic wait and no
   two-party pipe deadlock, and guest demux is trivial (`MAX_PARKED_REQUESTS = 1`).
2. **Input is pulled, never pushed.** DOM input accumulates in a host-side bounded
   FIFO and is handed to the guest only inside a `poll_event`/`wait_event` response.
3. **Framing fatal vs recoverable.** Bad `MAGIC`, unknown `VERSION`, or
   `LENGTH > MAX_FRAME_BYTES` are **fatal** (stream untrusted → tear down this run's
   device; per-run/per-instance only). An **unknown/unroutable channel**, empty
   payload, bad JSON, or any service-level validation failure is **recoverable**
   (channel-local error; the device and other services survive).
4. **Host never trusts guest JSON shape.** The object registry is a `Map` (ids are
   opaque strings, `__proto__`/`constructor`/`prototype` are just ordinary keys and
   are never written to an object prototype). Each op copies a fixed **field
   allow-list** field-by-field; guest keys are never spread/merged onto host objects.
   Every numeric field is re-validated with `Number.isFinite` **after** `JSON.parse`
   (because `JSON.parse('{"n":1e999}')` yields `Infinity` without throwing), then
   range-clamped. `font_size` and stroke `width` are capped (render-DoS).
5. **Reader/writer rules.** Readers parse the 8-byte header only once ≥8 bytes are
   buffered, then wait for `8+LENGTH`; buffer is capped at `8+MAX_FRAME_BYTES`. Guest
   `os.write`/`os.read` use short-write/short-read loops. The guest treats the `-1`
   close sentinel (clean) and a terminated worker (Stop) as end-of-stream →
   `GraphicsClosed`. An incomplete frame (fewer bytes than `LENGTH`) parks the reader
   with bounded memory until more bytes or teardown; this is accepted and documented.
6. **Helper module is a package directory.** The Python helper ships as
   execution-only `/graphics/__init__.py` (guest `/graphics/__init__.py`), **not**
   `/graphics.py`. A top-level `/graphics.py` would flatten to the same engine path as
   a student's `/workspace/graphics.py` and throw a hard collision that blocks *every*
   run and test. A package directory flattens to `graphics/__init__.py`, never
   collides, and CPython imports the package in preference to a shadowed user
   `graphics.py`. `graphics` (and `graphics.turtle`) are **reserved module names**.
7. **Panel identity.** Panel id `web-ide.python-graphics`, title **"Graphics"** — the
   built-in `canvasPlugin` already owns id `canvas`/title "Canvas" and the shared
   contribution registry throws on duplicate id. Hosts adopting this companion
   normally omit the stock `canvasPlugin`.
8. **Reactive controller bridge + lifecycle.** The `activate`→panel bridge is a
   subscribable per-session registry (not a bare `WeakMap` read), so the panel updates
   when the controller appears/disappears and survives React StrictMode's throwaway
   session. The host-device registration and the controller are both disposed when
   the plugin deactivates (the plugin returns a cleanup function; `context.register`
   is the equivalent mechanism); the registry entry is deleted only when it still
   identities to
   this activation's controller. End-of-run is driven by the device **`signal` abort**
   (the per-run authority), not the `exit` event.

Target: Web IDE `0.10.0` @ `0f36dab`, engine `debugger-sh@0.3.15-webide.0.9.0.1`.
A reusable, framework-generic browser Python 2D graphics companion that plugs into
Web IDE through **public package exports only** (`web-ide`, `web-ide/runtimes`,
`web-ide/host`, `web-ide/plugins`). No `web-ide/src` internals, no second interpreter,
no application code (auth/AI/persistence/branding/backend).

## 1. Why this shape

The task is an introductory 2D API with **stable object handles** and mutation
(move/update/delete/visibility/bounds/layering). That is a *retained* model: the
student holds handles and changes objects over time. So the host keeps a **retained
scene model** and a renderer projects it. This is confirmed appropriate by the
feature list (handles + layering + bounds) and by how the only guest↔host channel
works (below): we cannot cheaply replay an immediate-mode command stream for hit
testing, z-order queries, or text metrics.

**SVG vs Canvas 2D.** Chosen: **SVG**.
- Retained DOM nodes map 1:1 to object handles → trivial, correct z-order, mutation,
  and removal; no manual repaint bookkeeping.
- Crisp text + measurable bounds via `getBBox()` (needed for the `bounds` request and
  text anchors).
- Built-in hit-testing and per-object pointer targets; scaling via `viewBox` gives
  clean logical↔device coordinate mapping through the SVG CTM.
- Accessibility (focusable, labelled) for scoped keyboard focus.
- Cost: large node counts (10k+) are slower than Canvas. Acceptable for an
  *introductory* API; bounded by `MAX_OBJECTS`. The renderer is kept behind a small
  `SceneRenderer` seam so a Canvas backend could be added later without touching the
  protocol or scene model.

## 2. Transport: the one byte device, multiplexed

Web IDE exposes exactly **one** idle `RuntimeSession.registerHostDevice(opener)` per
session; the opener is **run-scoped** (invoked once per run with a fresh
`{signal,onData,write}`), writes must be awaited and are **serial**, `onData` chunks
are ≤ 64 KiB, and the signal aborts on exit/stop/dispose. Python reads/writes it with
`os.open("/dev/debugger-sh-host", os.O_RDWR)` (blocking, partial reads allowed). The
stock Python provider does **not** advertise `hostChannels`, so the byte device is the
only duplex path — we own all framing.

To let a host run graphics **and another independent service over the same device**,
we define a tiny **multiplexer** with per-channel framing. The default composition
wires graphics only; a host may inject additional services on other channels.

### 2.1 Frame format (both directions)

```
offset  size  field
0       1     MAGIC   = 0xC7
1       1     VERSION = 0x01        (transport/mux version)
2       2     CHANNEL (uint16, big-endian)
4       4     LENGTH  (uint32, big-endian)  = payload byte length
8       LEN   PAYLOAD (UTF-8 JSON for channel 0 and the graphics service)
```

- Header is 8 bytes. `LENGTH` **MUST** be ≤ `MAX_FRAME_BYTES = 262144` (256 KiB).
  A larger length, bad `MAGIC`, or unknown `VERSION` is a **fatal transport error**:
  the stream can no longer be trusted, so the connection is torn down (that run's
  device only — per-run, per-instance, so no other instance is affected). Both sides
  enforce this bound **before** allocating/among reads.
- Payloads are framed independently of the engine's 64 KiB slot chunking; the reader
  accumulates `onData`/`os.read` bytes until a full frame is present, with the buffer
  capped at header + `MAX_FRAME_BYTES`.

### 2.2 Channels

| channel | owner                | notes                                   |
| ------- | -------------------- | --------------------------------------- |
| 0       | multiplexer control  | `hello`/`welcome`/`error`               |
| 1       | graphics service     | default graphics channel                |
| 2..255  | host-injected services | each host service claims a channel     |

Channel assignment is static per composition and is part of the **handoff contract**
(§6): a host adding a second service agrees the channel number with that service's
guest client out of band. Graphics is always channel 1.

### 2.3 Control channel (0) messages (JSON)

- guest→host `{"t":"hello","mux":1}`
- host→guest `{"t":"welcome","mux":1,"services":[{"channel":1,"capability":"graphics","version":1}, ...]}`
- host→guest `{"t":"error","code":"...","message":"..."}` (fatal mux error before teardown)

The guest performs this handshake once; an unsupported `mux` version → `error` →
client raises a clear exception instead of guessing.

## 3. Graphics service protocol (channel 1, JSON, version 1)

Guest→host objects carry `"op"`. **Requests** also carry `"id"` (uint32, monotonic)
and expect exactly one response; **commands** omit `id` and never get a response.
Host→guest responses: `{"id":N,"ok":true,"result":{...}}` or
`{"id":N,"ok":false,"error":{"code":"...","message":"..."}}`.

Scene coordinates are **logical canvas units**, origin top-left, x→right, y→down,
floats. The SVG `viewBox` is `0 0 W H`; the panel scales with
`preserveAspectRatio="xMidYMid meet"`. Pointer coordinates in events are mapped back
to logical units via the inverse CTM.

### 3.1 Requests

| op           | payload                                   | result                                   |
| ------------ | ----------------------------------------- | ---------------------------------------- |
| `init`       | `{client,version}`                        | `{service:"graphics",version,limits}`    |
| `metrics`    | `{}`                                       | `{w,h}` (actual, post-clamp)             |
| `bounds`     | `{target:<objectId>}`                      | `{x,y,w,h}` (measured; text via getBBox) |
| `pause`      | `{ms}` (0 ≤ ms ≤ `MAX_PAUSE_MS` = 60000)   | `{}` after host timer (cancellable)      |
| `wait_event` | `{timeout_ms?}` (≤ `MAX_PAUSE_MS`)         | `{event: <Event> | null}`                |
| `poll_event` | `{}`                                       | `{event: <Event> | null}` immediately    |

### 3.2 Commands (applied in arrival order)

| op        | payload                                                              |
| --------- | -------------------------------------------------------------------- |
| `canvas`  | `{w,h,background?,title?}` — (re)creates the surface, clears scene   |
| `add`     | `{id, shape, ...geometry, ...style, visible?}`                        |
| `move`    | `{id, dx, dy}`                                                        |
| `moveto`  | `{id, x, y}`                                                          |
| `update`  | `{id, props:{...geometry/style/text}}`                               |
| `delete`  | `{id}`                                                                |
| `visible` | `{id, on}`                                                           |
| `order`   | `{id, mode:"front"|"back"|"forward"|"backward"}`                    |
| `clear`   | `{}` — remove all objects, keep canvas                               |

Shapes & geometry:
- `line`      `{x1,y1,x2,y2}`
- `polyline`  `{points:[[x,y],...]}`
- `rect`      `{x,y,w,h}` (top-left + size)
- `oval`      `{x,y,w,h}` (bounding box)
- `polygon`   `{points:[[x,y],...]}`
- `text`      `{x,y,text, anchor?, font_size?, font_family?}`

Style: `fill?` (shape interior; omit/`null` = none), `outline?` (stroke color),
`width?` (stroke width ≥ 0), `opacity?` (0..1). Colors validated by §4. Text uses
`fill` as its color. `anchor` ∈ {nw,n,ne,w,center,e,sw,s,se} (default nw for shapes'
text origin; `center` common for labels).

### 3.3 Events (only ever inside `wait_event`/`poll_event` results)

```
{kind:"mousedown"|"mouseup"|"mouseclick"|"mousemove"|"mousedrag", x, y, button}
{kind:"keydown"|"keyup"|"keypress", key, text?}     # key normalized; text = printable char
```

- The host keeps a **bounded FIFO** (`MAX_EVENT_QUEUE = 512`). Consecutive
  `mousemove`/`mousedrag` are **coalesced** (latest wins) to prevent flooding; on
  overflow the oldest non-coalesced events are dropped (bounded memory).
- `wait_event` pops the oldest; if empty it **parks** until an event arrives or
  `timeout_ms` elapses (host timer) → `{event:null}`. At most a small bounded number
  of parked requests is accepted; beyond that → `bad_request`.

### 3.4 Errors (codes)

`bad_request` (malformed/validation), `unknown_object`, `duplicate_object`,
`too_many_objects`, `limit_exceeded`, `unsupported` (reserved for a future
image/asset API; no op emits it in v1), `internal`.
Per-channel errors are **recoverable** (channel-local; the other services and the
device survive). Only transport framing corruption (§2.1) tears down the connection.

### 3.5 Limits (`limits` from `init`; enforced on BOTH sides)

```
MAX_FRAME_BYTES     262144   MAX_OBJECTS        10000
MAX_POINTS          10000    MAX_TEXT_LEN        4096
MAX_CANVAS_DIM      4096     MAX_PAUSE_MS        60000
MAX_EVENT_QUEUE     512      MAX_PARKED_REQUESTS 1
MAX_FONT_SIZE       512      MAX_STROKE_WIDTH    512
```

NaN/Infinity coordinates, non-finite sizes, negative width, unknown shape/op,
oversized text/points, and unknown object ids are rejected (`bad_request` /
`unknown_object`), never applied.

## 4. Safe color / no-injection rules

- Colors accept: a fixed set of CSS named colors (allow-list), `#rgb`, `#rrggbb`,
  `#rgba`, `#rrggbbaa`, and `rgb()/rgba()` with numeric components only — validated by
  strict regex + allow-list. No `url(...)`, no arbitrary CSS, no `expression(...)`.
- Text is rendered as SVG `<text>` **textContent** (never `innerHTML`); font-family is
  restricted to an allow-list of generic families.
- **Images are unsupported in v1** (`unsupported`): no URL fetch, no `<image href>`,
  no unbounded decode. Follow-up (documented): a bounded asset registry — host-approved
  data provided as a size/dimension-capped `ImageBitmap`, addressed by opaque id, never
  a guest-controlled URL.

## 5. Web IDE integration (adapter)

- **Python helper** ships as an **execution-only** resource *package directory*
  at guest `/graphics/__init__.py` (+ `/graphics/turtle.py`), importable as
  `import graphics` / `from graphics.turtle import Turtle` from `/main.py`
  (confirmed by the `/sysroot` flatten + `sys.path` containing `/`). A package
  directory — not a top-level `/graphics.py` — is required: `/graphics.py` would
  flatten to the same engine path as a student's `/workspace/graphics.py` and
  throw a hard collision that blocks every run (see §0.6). It is absent from the
  editor/explorer/persisted projection. The turtle adapter is turtle-*style*,
  explicitly not stdlib `turtle`.
- **Registration** happens in `plugin.activate(context)` while idle:
  `context.runtime.registerHostDevice(openerForMultiplexer)`, disposed on plugin
  deactivation via the returned cleanup. A per-session `WeakMap<RuntimeSession, GraphicsController>`
  bridges the controller to the **panel** (which only receives `IDEPanelServices`),
  giving per-instance isolation (one session per mount).
- **Panel** (`IDEPanelContribution`, id `web-ide.python-graphics`, title
  "Graphics" — not the built-in `canvasPlugin`'s id `canvas`/title "Canvas")
  renders the SVG from the
  controller's scene, forwards scoped pointer/keyboard input, and shows a placeholder
  when no graphics device is connected (e.g. non-graphics runtime, or before first
  run). Keyboard is captured **only when the canvas is focused** (tabindex), never
  document-wide.
- **Per-run**: opener invoked → controller binds the run's device, **resets** the
  scene; on abort (exit/stop) → controller freezes the final image and marks
  disconnected. New run → new device → reset.
- **Composition**:
  - `pythonGraphicsPlugin` — default, graphics only.
  - `createPythonGraphicsPlugin({ createAdditionalServices })` — graphics on
    ch.1 + host services on ch.2…; or
  - `new DeviceMultiplexer({ services: [graphicsService, …] }).opener` +
    `GraphicsService` for a host that wants to own `registerHostDevice` itself.
- Web IDE remains fully usable without the companion (purely additive, separate pkg).

## 6. Versioned handoff contract (consumer agreement)

Owned/versioned by this package:
- **Transport**: `MAGIC/VERSION=1`, frame layout, `MAX_FRAME_BYTES`, channel map,
  fatal-vs-recoverable error rule.
- **Graphics service**: `capability="graphics"`, `version=1`, the op/result/event
  vocabulary and limits above.

A host composing an additional service agrees: (a) its channel number (≥2),
(b) that it owns framing for its channel payloads, (c) the serial-write discipline
(the multiplexer serializes all writes across channels), (d) that transport-fatal
errors tear down the shared connection. Breaking changes bump `VERSION` (transport)
or the service `version` (graphics) with negotiation in `hello`/`init`; a mismatched
peer gets a clean error, never undefined behavior.

## 7. Package / build / test

- Standalone repository/package `@web-ide/python-graphics` (originally developed
  under web-ide's `packages/python-graphics`, then exported with history), MIT
  (mirrors repo license; no repo license change). Peer deps: `react`, `react-dom`,
  `web-ide`. Own `vite` library build (ES, externalize react + `web-ide*`), own
  `tsc`/`eslint`/`vitest`, declarations emitted + specifier-rewritten like web-ide.
- Does **not** modify web-ide root `package.json` (keeps the release/consumer gate and
  tarball integrity intact) and is **not** added to web-ide root workspaces.
- Minimal **durable** tests (colocated, small): protocol frame + message codec vectors
  and bound rejections; scene-model mutation/layering/bounds; multiplexer lifecycle
  with a fake device + a mock second service (routing, serial writes, per-run reset,
  abort cleanup, malformed/late frames); one focused browser smoke.
- **Broad browser QA** (not committed): a packed-candidate clean consumer (web-ide tgz
  + companion tgz, no aliases/siblings) driven by Playwright across shapes/text,
  mutation/layering, input + scaled coords, stop/rerun, debug, error recovery, two
  instances, host-without-graphics, graphics+mock-second-service on one device.
  Screenshots at desktop + narrow saved as external artifacts.

## 8. Explicitly deferred (with reason)

- **Images**: unsupported in v1 (security: uncontrolled URLs / unbounded decode).
  Follow-up = bounded host-approved asset registry (above).
- **turtle stdlib parity**: not claimed. Only a small turtle-*style* adapter, with
  unsupported calls raising clearly.
- **Canvas 2D backend / huge object counts**: SVG only in v1; renderer seam left for a
  future Canvas backend.
