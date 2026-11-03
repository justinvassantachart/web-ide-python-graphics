# @web-ide/python-graphics

A reusable, browser-based **introductory 2D graphics** companion for the
[`web-ide`](../../README.md) component. A Python program draws shapes and text,
gets back stable handles, moves/updates/deletes them, reads mouse and keyboard
input, and paces animation — all rendered in a Web IDE panel. It integrates
through Web IDE's **public plugin and runtime APIs only**; it ships no second
Python interpreter and contains no application code (no auth, AI, persistence,
branding, or backend).

> Status: v0.1, developed in-repo alongside web-ide. Not published to a
> registry. Consume it from a packed tarball or a workspace `file:` reference.

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

Peer dependencies: `react`, `react-dom`, and `web-ide` (optional — only the
plugin/panel needs it; the renderer, service, model, and protocol are
framework-generic). The companion has **no runtime dependencies** of its own.

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
omit the stock `canvasPlugin` (it renders nothing for Python). Web IDE still
serves pages with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (required by the runtime).

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

`graphics` and `graphics.turtle` are reserved module names. A turtle-*style*
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

## Security

Colors are a strict allow-list (`#hex`, numeric `rgb()/rgba()`, named colors) —
no `url()`, CSS functions, or custom properties. Text renders as SVG text
content, never HTML. All guest input is bounded and re-validated on the host
(finite numbers, object/point/text/canvas limits, no prototype pollution).
Keyboard capture is scoped to the focused canvas; there is no document-wide
capture or mutable global canvas. Images are intentionally unsupported in v1.

## Limitations / deferred

- **Images**: unsupported in v1 (`unsupported` error); a bounded host-approved
  asset registry is the planned follow-up.
- **turtle stdlib parity**: not claimed; only a turtle-style adapter.
- **Renderer**: SVG only; a Canvas 2D backend (for very high object counts) is a
  possible future addition behind the existing renderer seam.

## Development (in-repo)

The package reuses the repository's installed toolchain:

```sh
cd packages/python-graphics
npm run validate     # eslint + tsc + vitest + vite build
```

It does not modify web-ide's root `package.json`, so web-ide's own release and
packed-consumer gates are unaffected. See [docs/DESIGN.md](docs/DESIGN.md) for
rationale and [docs/INTEGRATION.md](docs/INTEGRATION.md) for the binding
protocol and test vectors.
