# @web-ide/python-graphics

A reusable, browser-based **introductory 2D graphics** companion for the
[`web-ide`](https://github.com/justinvassantachart/web-ide) component. A Python program draws shapes and text,
gets back stable handles, moves/updates/deletes them, reads mouse and keyboard
input, and paces animation — all rendered in a Web IDE panel. It integrates
through Web IDE's **public plugin and runtime APIs only**; it ships no second
Python interpreter and contains no application code (no auth, AI, persistence,
branding, or backend).

> Status: v0.3.0-images.0 candidate. A separately maintained companion to web-ide (like
> `@web-ide/karel`), consuming only its public plugin and runtime APIs. Not
> published to a registry; consume it from a packed tarball (see Installation)
> or a `file:` reference. Verified against web-ide `0.11.0-images.0` and the binary-file engine candidate.

## What it is

- A **retained scene model** on the host and an **SVG renderer** in the panel.
- A **bounded, versioned byte-device protocol** with a **multiplexer**, so a
  host can run graphics and an independent service over Web IDE's single
  registered host device. The protocol is deadlock-safe over the blocking
  duplex device (response-only, one outstanding request) and validates both
  sides of the trust boundary. See [docs/INTEGRATION.md](docs/INTEGRATION.md).
- A small **Python library** (`graphics`) shipped as an execution-only resource.
- An optional **Web IDE plugin** that wires it all together.

## Install / compose (host side)

Peer dependencies: `react`, `react-dom`, and `web-ide >=0.11.0-images.0`.
The headless `/core` entry consumes only `web-ide/assets`; the standalone
`/transport` entry remains independent of Web IDE and React.

```tsx
import { WebIDE, WebIDEHostProvider, type WebIDEConfiguration } from 'web-ide'
import { pythonRuntimePlugin } from 'web-ide/runtimes'
import { coreWorkbenchPlugin } from 'web-ide/plugins'
import { pythonGraphicsPlugin } from '@web-ide/python-graphics'
import 'web-ide/styles.css'

const configuration: WebIDEConfiguration = {
  runtimeProvider: 'web-ide.runtime.python',
  plugins: [pythonRuntimePlugin, coreWorkbenchPlugin, pythonGraphicsPlugin],
  initialLayout: { selectedPanelId: 'web-ide.python-graphics' },
}
```

The panel appears as a **Graphics** tab. Hosts adopting this companion normally
omit the stock `canvasPlugin` (it renders nothing for Python). The panel follows
the workbench theme and shows a hint until the program issues its first graphics
command; a program that never draws ends with a "finished without drawing" note
rather than a blank canvas. The canvas is keyboard-focusable (focus ring on
`:focus-visible`) and keyboard input reaches the program only while focused. Web IDE still
serves pages with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (required by the runtime).

### Installation (exact)

Not published to a registry. Install from packed tarballs:

```sh
# 1. web-ide: use the release asset for the version you target, e.g.
#    https://github.com/justinvassantachart/web-ide/releases/download/web-ide-v0.11.0-images.0/web-ide-0.11.0-images.0.tgz
# 2. this package: from a GitHub release asset, or build it yourself:
npm ci && npm run build && npm pack       # -> web-ide-python-graphics-0.3.0-images.0.tgz

# 3. In your application:
npm install /abs/path/web-ide-0.11.0-images.0.tgz \
            /abs/path/web-ide-python-graphics-0.3.0-images.0.tgz \
            react react-dom
```

Configure Vite as in [`consumer-check/app/vite.config.ts`](consumer-check/app/vite.config.ts):
`vite-plugin-wasm`, the `node:` shim aliases, `dedupe: ['react','react-dom']`,
`optimizeDeps.exclude: ['debugger-sh']`, `build.target: 'esnext'`, and the
COOP/COEP response headers. `WEB_IDE_TARBALL=… npm run check:consumer` performs
this exact install + production build as an automated check.

### Student-facing Python

```python
from graphics import Canvas

c = Canvas(400, 300, title="Bouncing box")
box = c.create_rectangle(0, 0, 60, 40, fill="skyblue", outline="navy", width=2)
label = c.create_text(200, 16, "click to nudge", color="black", anchor="center")

dx, dy = 3, 2
while c.is_open():
    event = c.poll_event()
    if event and event.type == "mouseclick":
        box.move(20, 0)
    box.move(dx, dy)
    bounds = box.get_bounds()
    if bounds["x"] <= 0 or bounds["x"] + bounds["w"] >= c.width:
        dx = -dx
    c.pause(16)        # host-timed, cancellable
```

`graphics`, `graphics.turtle`, and `web_ide_transport` are reserved module names. A turtle-*style*
adapter is available (`from graphics.turtle import Turtle`); it is not the
standard-library `turtle` and raises a clear error on unsupported calls.

## API summary (Python)

- `Canvas(width, height, title="", background="white")`
- Drawing: `create_line`, `create_polyline`, `create_rectangle`, `create_oval`,
  `create_circle`, `create_polygon`, `create_text`; returns a `GraphicsObject`.
- Handle: `move`, `move_to`, `set_fill`, `set_outline`, `set_width`,
  `set_opacity`, `set_text`, `set_font_size`, `hide`/`show`/`set_visible`,
  `to_front`/`to_back`/`forward`/`backward`, `get_bounds`, `delete`.
- Scene: `canvas.clear()`, `canvas.move(obj, dx, dy)`, `canvas.delete(obj)`.
- Input/timing: `get_event(timeout=None)`, `poll_event()`, `get_mouse()`,
  `wait_for_click()`, `pause(ms)`, `is_open()`.

Invalid arguments raise `GraphicsError`; `GraphicsClosed` signals the run ended.

## Package exports (TypeScript)

`@web-ide/python-graphics` exports four usable layers:

- **adapter**: `pythonGraphicsPlugin`, `createPythonGraphicsPlugin`,
  `GraphicsPanel`, `GraphicsController`, resources.
- **renderer**: `SvgCanvas` (framework-generic).
- **service + mux**: `GraphicsService`, `DeviceMultiplexer`, `HostService`.
- **model + protocol**: `Scene`, `encodeFrame`/`FrameReader`, `LIMITS`, etc.
- **worker boundary validators**: `parseSceneSnapshot`/`isSceneSnapshot` and
  `parseGraphicsInput`/`isGraphicsInput`, returning detached, bounded safe values.

Worker hosts must import headless graphics from
`@web-ide/python-graphics/core`: `GraphicsController`, `GRAPHICS_PYTHON_SOURCES`,
model/service helpers, input/snapshot validators and their types. This entry has
no React, renderer, plugin, Web IDE or DOM runtime imports. The root entry
includes UI exports and is intended for the main thread; tree-shaking unused UI
exports does not guarantee that React's CommonJS initialization leaves a worker.
`npm run check:worker` verifies actual bundled workers and rejects the root UI
entry as a negative control. Version 0.2.1 adds this packaging boundary without
changing graphics behavior or wire protocols.

The separate `@web-ide/python-graphics/transport` export provides
`DeviceMultiplexer`, `createJsonService`, `ServiceError`, framing helpers, and
`TRANSPORT_PYTHON_SOURCES` without graphics/React/Web IDE imports. Python
`get_connection().service(capability, version=1)` owns one lazy shared device
connection for graphics and independent services. See the exact public API,
timeout/cancellation rules and 0.1 migration in [INTEGRATION.md](docs/INTEGRATION.md).
`GraphicsController.reset()` clears a prior run before a new run with disabled
services, so a non-graphics run cannot show stale output.
The normal `GRAPHICS_PYTHON_SOURCES` map includes the neutral source; hosts
composing resources manually should include each path once.

### Actual turtle-style API

`Turtle(canvas=None, width=400, height=400)` supports `forward`/`backward`,
`goto`, `left`/`right`, `setheading`, `home`, `penup`/`pendown`, `pencolor`,
`pensize`, `dot`, `write`, `position`, `heading`, `clear`, `is_open`, `pause`,
and `get_canvas`. Common aliases include `fd`, `bk`/`back`, `lt`, `rt`, `seth`,
`setpos`/`setposition`, `pu`/`up`, `pd`/`down`, `color`/`pencolour`, `width`, and
`pos`. `speed` is accepted as a no-op; animation pacing uses `pause`.

The origin is the top-left of the Canvas. The turtle starts at its center;
heading 0 points right and positive angles turn counterclockwise. `home` moves
back to the center without changing heading. `color` sets the pen color only;
there is no separate fill-color state. `clear` clears the entire shared Canvas.
There is no stdlib `turtle` import, fill, stamp, clone, turtle shape, tracer,
undo, or image API. Unsupported listed operations raise `GraphicsError`.

## Security

Colors are a strict allow-list (`#hex`, numeric `rgb()/rgba()`, named colors) —
no `url()`, CSS functions, or custom properties. Text renders as SVG text
content, never HTML. All guest input is bounded and re-validated on the host
(finite numbers, object/point/text/canvas limits, no prototype pollution).
Aggregate retained geometry is capped at 100000 polyline/polygon vertices and
text at 1048576 UTF-16 units, independently of per-object limits.
Keyboard capture is scoped to the focused canvas; there is no document-wide
capture or mutable global canvas. Image decoding, transfers and retained rasters
are separately bounded by the shared `web-ide/assets` service.

## Limitations / deferred

- **turtle stdlib parity**: not claimed; only a turtle-style adapter.
- **Renderer**: retained SVG with raster image canvases; a Canvas 2D backend (for very high object counts) is a
  possible future addition behind the existing renderer seam.

## Development

```sh
npm ci
npm run validate                                   # eslint + tsc + vitest + vite build
WEB_IDE_TARBALL=/abs/path/web-ide-0.11.0-images.0.tgz npm run check:consumer
```

`web-ide` is a devDependency pinned to the release tarball this version was
verified against; it is only used for type-checking and the consumer check (the
library build externalizes it). To develop against a local web-ide checkout
instead, point the devDependency at `file:../web-ide` after building web-ide's
`dist/` (the pattern web-ide documents for Nova).

See [docs/DESIGN.md](docs/DESIGN.md) for rationale,
[docs/INTEGRATION.md](docs/INTEGRATION.md) for the binding protocol and test
vectors, [docs/VERIFICATION.md](docs/VERIFICATION.md) for the verification
record, and [RELEASING.md](RELEASING.md) for the release process.

### Images and course graphics

The images candidate supports `from simpleimage import SimpleImage` and
`from graphics import Image`, with compact local pixel loops, PNG/JPEG/WebP
loading, independent image outputs and PNG/JPEG guest-file saves. `Canvas`
retains image sprites alongside shapes and text. `from drawcanvas import
DrawCanvas` supplies the width/height drawing facade, and native controls
support the adapted Baby Graphics and Sand/Waterfall starter shells.
See [image integration and API contracts](docs/INTEGRATION.md#image-and-teaching-graphics-integration).
Host applications still own uploads, persistence, permissions and explicit
Save to project. One interactive canvas and multiple image outputs are supported.
