# Integration & versioned wire contract — @web-ide/python-graphics

This is the **binding** contract between the Python guest helper and the host
renderer, and the handoff a host agrees to when composing an additional service
on the shared byte device. Design rationale lives in `DESIGN.md`.

- Transport version: **1** (`FRAME_MAGIC = 0xC7`, `TRANSPORT_VERSION = 1`).
- Graphics service: capability `graphics`, **version 2** (0.3 image/control command set).
- Any incompatible change bumps the relevant version; a mismatched peer gets a
  clean error at handshake, never undefined behavior.

## 0. Normative invariants (MUST)

1. **Response-only host→guest; one outstanding request.** Every byte the host
   writes to the guest is the single response to a prior guest **request**. The
   host never pushes unsolicited frames. The guest keeps at most one request
   outstanding, then blocks reading until its response arrives. **Commands**
   (no `id`-correlated reply) get no response. An injected service MUST obey the
   same discipline. This makes the blocking duplex stream deadlock-free.
2. **Input is pulled, not pushed.** DOM input accrues in a bounded host FIFO and
   is delivered only inside a `poll_event`/`wait_event` response.
3. **Fatal vs recoverable.** Bad frame magic/version/length, malformed JSON,
   overlapping requests, failed host writes, and an overflowing write queue stop
   the connection. The mux unsubscribes, aborts every request/service signal, and
   disconnects each service exactly once. Its `onFatal` callback MUST stop the
   owning runtime: the public `RuntimeHostDevice` has no close method. The
   built-in plugin supplies `onFatal: () => session.stop()`. A well-formed
   request to an unknown channel gets a control error; a service request failure
   gets a correlated error and leaves independent services usable.
4. **Both sides validate.** The host trusts no guest JSON: object ids are opaque
   `Map` keys (no prototype pollution), each op copies a fixed field allow-list
   (guest keys are never spread onto host objects), every number is re-checked
   with `Number.isFinite` after parsing, and all counts/sizes are bounded. The
   Python client mirrors these checks as a **strict subset** so a value it
   accepts is always accepted by the host (commands are fire-and-forget, so a
   host-side rejection would otherwise be silent).

## 1. Transport framing (both directions)

```
offset size field
0      1    MAGIC   = 0xC7
1      1    VERSION = 0x01
2      2    CHANNEL (uint16, big-endian)
4      4    LENGTH  (uint32, big-endian) = payload byte length
8      LEN  PAYLOAD (UTF-8 JSON object on every channel)
```

`LENGTH` MUST be ≤ `MAX_FRAME_BYTES` (262144). The reader validates the 8-byte
header before accumulating a payload, so a hostile length cannot force an
unbounded buffer. A frame may span multiple device wakes / `os.read`s; the
reader accumulates until `8 + LENGTH` bytes are present.

### Channels

| channel | owner                   |
| ------- | ----------------------- |
| 0       | multiplexer control     |
| 1       | graphics service        |
| 2..65535 | host-injected services |

Control (channel 0), JSON: guest→host `{"t":"hello","mux":1}`; host→guest
`{"t":"welcome","mux":1,"services":[{"channel":1,"capability":"graphics","version":2}, …]}`;
host→guest `{"t":"error","code":"…","message":"…"}`.

The host validates `hello.mux === 1` before dispatching any service frame and
accepts only one hello per run. Both sides reject duplicate channel or capability
ownership and invalid versions. Guests discover channels by capability; graphics
uses channel 1 by default but a host may assign another advertised channel.

All JSON service requests carry numeric `id` values, increasing globally from 1
through 4294967295, shared across **all** services. IDs never wrap or repeat in a
run. Commands have no `id` or a string object id, and never receive responses.
Responses must match both the owning channel and the pending ID and include a
boolean `ok`. Stale, duplicate, wrong-channel, and unsolicited responses are
ignored. A second guest frame while a request is pending is a fatal protocol
violation, preventing duplex-device deadlocks.

The default request deadline is 65000 ms; hosts can set `requestTimeoutMs` from
1 through 300000. Expiry returns `{ok:false,error:{code:"timeout",message:...}}`,
aborts the request's signal, and frees the global slot. A handler must honor
that signal for its own external work; late responses are rejected even when it
does not. `createJsonService` exposes only explicit `ServiceError(code,message)`
messages; unexpected exceptions return a generic `internal` error. The outgoing
write queue is capped at 64 frames and all writes are awaited serially.

## 2. Graphics service (channel 1, JSON, v2)

Requests carry a monotonic uint32 `id` and expect exactly one response:
`{"id":N,"ok":true,"result":{…}}` or `{"id":N,"ok":false,"error":{"code","message"}}`.
Commands omit a reply. **Request and command op-names are disjoint**, so the
dispatcher routes by `op` (never by presence of `id` — on a command, `id` is the
object id). Coordinates are logical canvas units (origin top-left, y down).

Requests: `init`, `metrics`, `bounds{target}`, `pause{ms}`,
`wait_event{timeout_ms?}`, `poll_event`.
Commands: `canvas{w,h,background?,title?}`, `add{id,shape,…}`, `move{id,dx,dy}`,
`moveto{id,x,y}`, `update{id,props}`, `delete{id}`, `visible{id,on}`,
`order{id,mode}`, `clear`.

Shapes: `line{x1,y1,x2,y2}`, `polyline{points}`, `rect{x,y,w,h}`,
`oval{x,y,w,h}`, `polygon{points}`, `text{x,y,text,anchor?,font_size?,font_family?}`.
Style: `fill?`, `outline?`, `width?`, `opacity?`. Colors are a named allow-list ∪
`#hex` ∪ numeric `rgb()/rgba()` only. `font_family` ∈ {sans-serif, serif,
monospace, system-ui, cursive, fantasy}. `anchor` ∈ {nw,n,ne,w,center,e,sw,s,se}.

Events (only inside a `poll_event`/`wait_event` result):
`{kind:"mousedown|mouseup|mouseclick|mousemove|mousedrag", x, y, button}` and
`{kind:"keydown|keyup|keypress", key, text?}`.

Error codes: `bad_request`, `unknown_object`, `duplicate_object`,
`too_many_objects`, `limit_exceeded`, `unsupported`, `internal`.

### Limits (enforced on both sides)

| name             | value  | name              | value |
| ---------------- | ------ | ----------------- | ----- |
| MAX_FRAME_BYTES  | 262144 | MAX_TEXT_LEN      | 4096  |
| MAX_OBJECTS      | 10000  | MAX_CANVAS_DIM    | 4096  |
| MAX_POINTS       | 10000  | MAX_PAUSE_MS      | 60000 |
| MAX_EVENT_QUEUE  | 512    | MAX_PARKED_REQS   | 1     |
| MAX_FONT_SIZE    | 512    | MAX_STROKE_WIDTH  | 512   |

Aggregate scene limits are `MAX_SCENE_POINTS = 100000` polyline/polygon vertices
and `MAX_SCENE_TEXT_LEN = 1048576` UTF-16 units. Add/update budget failures leave
the original scene untouched. Delete/clear frees the budget. Both the Python
API and host model enforce these limits; worker snapshot validators independently
check them before accepting cross-thread data.

Text length is measured in UTF-16 code units (the Python client counts the same
so astral characters cannot slip past it).

Image sprites reference immutable `resourceId`/`resourceVersion` pairs from the
separate `images` service. The `image` shape adds `x,y,w,h,sampling`; neither a
scene nor its renderer fetches guest URLs. Controls add `control_add`,
`control_set`, `control_delete`, and `control_value`. Convenience requests include
`object`, `overlapping`, `pointer`, `drain_events`, and `flush`; `frame_begin` and
`frame_end` coalesce publication. The image/control details follow below.

### Object identity, batching, and the final image

- **Object id lifetime.** Ids are opaque strings (≤128 chars) allocated by the
  guest. The Python client allocates monotonically (`g1`, `g2`, …) and never
  reuses an id within a run, including after `delete`. The host rejects a
  duplicate `add` (`duplicate_object`) and a mutation of an unknown id, and ids
  do not survive a run: a new run resets the scene, so the id space restarts.
- **Batch publication.** Commands apply individually in arrival order; frame
  batching is not an all-or-nothing transaction. `frame_begin` suppresses visual
  publication until `frame_end` or `flush`, while every mutation immediately pins
  its image revisions. Publishing a replacement scene precedes unpinning removed
  resources. Use cancellable `pause` for animation pacing.
- **Final image.** When a run ends (program exit or Stop → device `signal`
  abort), the last applied scene remains displayed (frozen). The next run resets
  it when that run's device opens: the controller clears the scene on connect,
  before the program's first command.

## 3. Test vectors

Bytes (hex) produced by `encodeFrame(channel, encodeJson(message))`. A conforming
implementation MUST **parse** these frames. JSON object-key order is **not**
normative, so an implementation's own output may differ byte-for-byte (the
Python client appends `op`/`id` last, for example); both sides key by name. The
8-byte header and the payload's decoded JSON are the authoritative part.

```
control hello      ch0  {"t":"hello","mux":1}
  c7010000000000157b2274223a2268656c6c6f222c226d7578223a317d

control welcome    ch0  {"t":"welcome","mux":1,"services":[{"channel":1,"capability":"graphics","version":2}]}
  c7010000000000567b2274223a2277656c636f6d65222c226d7578223a312c227365727669636573...

graphics init req  ch1  {"op":"init","id":1,"client":"python-graphics","version":2}
  c70100010000003b7b226f70223a22696e6974222c226964223a312c22636c69656e74223a22707974686f6e2d6772617068696373222c2276657273696f6e223a327d

graphics init resp ch1  {"id":1,"ok":true,"result":{"service":"graphics","version":2,"limits":{"maxObjects":10000,"maxPoints":10000,"maxTextLen":4096,"maxCanvasDim":4096,"maxPauseMs":60000}}}
  c7010001000000a77b226964223a312c226f6b223a747275652c22726573756c74223a7b2273657276696365223a226772617068696373222c2276657273696f6e223a322c226c696d697473223a7b226d61784f626a65637473223a31303030302c226d6178506f696e7473223a31303030302c226d6178546578744c656e223a343039362c226d617843616e76617344696d223a343039362c226d617850617573654d73223a36303030307d7d7d

add rect cmd       ch1  {"op":"add","id":"g1","shape":"rect","x":10,"y":10,"w":80,"h":40,"fill":"skyblue","outline":"navy","width":2}
  c70100010000006d7b226f70223a22616464222c226964223a226731222c227368617065223a2272656374...

pause req          ch1  {"op":"pause","id":2,"ms":16}
  c70100010000001d7b226f70223a227061757365222c226964223a322c226d73223a31367d

wait_event resp    ch1  {"id":3,"ok":true,"result":{"event":{"kind":"mouseclick","x":42,"y":17,"button":0}}}
  c7010001000000547b226964223a332c226f6b223a747275652c22726573756c74223a7b226576656e74...
```

(The three truncated lines continue with the UTF-8 bytes of the shown JSON; the
header is the authoritative part. Regenerate full vectors from the package
exports with `encodeFrame`/`encodeJson`.)

## 4. Public entries and migration

### 0.2.1 worker entry

Public-player and other worker hosts import `GraphicsController`,
`GRAPHICS_PYTHON_SOURCES`, `parseGraphicsInput`, `parseSceneSnapshot`, and their
`GraphicsInput`/`GraphicsStatus`/`SceneSnapshot` types from
`@web-ide/python-graphics/core`. This entry exports the headless model, service,
controller, source maps and neutral transport; it never imports a renderer,
React, DOM or editor implementation. Source-map and measurement type modules
are also separated from UI declarations. The main-thread renderer (`SvgCanvas`)
and optional plugin continue to come from the root entry. Importing a few names
from the root barrel is not a worker-isolation guarantee: CommonJS React wrappers
may survive tree-shaking. Both public entries are checked in a real Vite worker
build against retained module IDs and code, including a failing UI-root control.

0.2.1 changes package entry boundaries only. Python API, framing version 1,
graphics version 1, limits and cancellation behavior are unchanged. The released
0.2.0 archive remains immutable.

### Neutral transport and migration from 0.1

`@web-ide/python-graphics/transport` is a separate framework-free entry point in
the exact same 0.2 archive. Its dependency graph contains framing, JSON routing,
and the neutral Python source only: no graphics implementation, React, Web IDE,
AI provider, credentials, or host policy. Keeping it in one archive makes the
host and guest transport inseparable at release/integrity verification time.

```ts
import {
  DeviceMultiplexer, createJsonService, ServiceError,
  TRANSPORT_PYTHON_SOURCES,
} from '@web-ide/python-graphics/transport'

const echo = createJsonService({
  channel: 2, capability: 'echo', version: 1,
  async handleRequest(message, { signal }) {
    if (signal.aborted) throw new ServiceError('cancelled', 'Request cancelled')
    if (message.op !== 'echo') throw new ServiceError('unsupported', 'Unknown operation')
    return { value: message.value }
  },
})
const transport = new DeviceMultiplexer({
  services: [echo], // no graphics required; optionally add graphicsController.hostService
  onFatal: () => session.stop(),
})
const registration = session.registerHostDevice(transport.opener)
// Contribute TRANSPORT_PYTHON_SOURCES as execution-only resources.
// Dispose registration when the owning IDE mount goes away.
```

```python
from web_ide_transport import get_connection, TransportError
service = get_connection().service("echo", version=1)
result = service.request("echo", value="hello")
service.close()  # only this facade; other services retain the shared connection
```

The Python singleton lazily opens one descriptor, performs one handshake, and
owns partial I/O, bounded reads, correlation and global request IDs. Importing
it opens nothing. `TransportError(message, code=None)` preserves host codes,
including uppercase application codes; `TransportClosed` has `code="closed"`.
Closing a Canvas closes its graphics client, not the connection used by AI.
Graphics uses this public API and no longer owns or exposes private device I/O.
For public-player worker boundaries, the graphics entry exports strict bounded
`parseSceneSnapshot`/`isSceneSnapshot` and `parseGraphicsInput`/`isGraphicsInput`.

0.2 preserves the documented Python graphics API, frame version 1, graphics
service version 1, and existing root exports. It formalizes the **JSON** service
profile and enforces the previously documented global single-request rule.
Custom 0.1 consumers must replace private `Canvas._conn._send/_read_json` access
with public service clients, use globally increasing numeric request IDs,
complete the hello handshake before service frames, and provide `onFatal` when
composing the mux manually. Opaque non-JSON injected payloads are no longer a
supported service profile. Existing raw `HostService` implementations remain
usable when they follow the JSON profile; new services should use
`createJsonService` to receive request-scoped cancellation and safe error mapping.

`get_event(None)` preserves its blocking behavior by repeating bounded 60000 ms
requests. Input remains pull-only. No streaming or unsolicited host push is
supported; applications that need progress must design bounded polling.

## 5. Web IDE integration specifics

- The Python helper ships as an **execution-only** resource package at guest
  `/graphics/__init__.py` (+ `/graphics/turtle.py`) and
  `/web_ide_transport/__init__.py`. `graphics`, `graphics.turtle`, and
  `web_ide_transport` are **reserved module names**; a workspace file named
  `graphics.py` is shadowed by the package (it does not break the run).
- The plugin registers one host-device opener in `activate` while the session is
  idle, bridges the per-run controller to the panel through a session-keyed
  reactive registry, and disposes both on deactivate. End-of-run is the device
  `signal` abort; the final image is retained until the next run.
- Panel id `web-ide.python-graphics`, title **Graphics** (do not reuse the
  built-in `canvasPlugin` id `canvas`). Keyboard is captured only while the
  canvas is focused.

## Image and teaching graphics integration

The images-capable companion requires `web-ide >=0.11.0-images.0`; its `/core`
entry imports only the headless `web-ide/assets` entry. `/transport` remains
independent. Register `controller.hostServices` on the existing multiplexer:
channel 1 is `graphics` version 2 and channel 3 is `images` version 1. Keep other services
on their own negotiated channels; do not open a second host device.

`GraphicsController.images` owns the shared image service. Its `snapshot`
observable carries presentation/output metadata, `readResource` supplies owned
RGBA pixels and renderer reservation accounting, and `service` supplies lazy
PNG downloads and generated-file bytes. Use `SvgCanvas`'s `readImageResource`
prop and `ImageGallery`. An optional `onSaveToProject` callback belongs to the
host: stage bytes and apply the full document under its ordinary revision and
permissions. `show()` and Download never persist a workspace edit.

Worker hosts must forward image events in order, before any scene referencing
them. The shared `createImageResourceReplica` validates and bounds those bytes;
fence every message by run generation. Preserve the final controller after
normal guest exit for Download, and dispose it on rerun/reset/unmount. Keep
request cancellation separate from image transfer lifetime: the transport
aborts each individual request signal after a successful reply too.

The execution resource map adds `graphics.image`, `simpleimage.py`, and
`drawcanvas.py`. `getPythonGraphicsAvailability` and
`getAvailablePythonGraphicsSources` select modules by dependency without
rewriting a student's colliding file. A `simpleimage.py` collision disables that
alias; the canonical graphics image API and other services remain available.
Transport collisions disable dependent modules. `detectDesktopImageHelper`
identifies PIL/Tk imports for an explicit adapted-copy workflow; never silently
replace a teacher or student helper.

### Student API

```python
from simpleimage import SimpleImage
from graphics import Canvas, Image

image = SimpleImage('images/photo.png')
for pixel in image:
    pixel.red = 255 - pixel.red
image.show('Result')
image.save('result.png')  # a real guest file, downloadable; host promotion is explicit
canvas = Canvas(600, 400)
sprite = canvas.create_image(20, 30, image, width=300, height=200)
sprite.move(10, 0)
```

`Image` preserves RGBA; `SimpleImage` uses opaque RGB. Mutable pixels remain in
one compact guest bytearray, so channel/tuple loops do not issue host requests.
Coordinates are strict integers; invalid bounds raise `IndexError`. Channels
accept finite numbers, truncate then clamp; booleans and strings are rejected.
Pixel objects are coordinate views, rechecking bounds after resize. Independent
iterators support nested loops. `set_pixel` copies values. `copy`, `crop`, and
`resized` return independently owned images; `make_as_big_as` resizes its receiver
with deterministic nearest-neighbor sampling. Width/height are read-only.

Load PNG/JPEG/WebP from relative project paths. Save PNG or JPEG to an ordinary
relative guest path; create parent directories using `os.makedirs` as usual.
Decoded browser photo orientation is honored. Teaching exactness fixtures use
opaque, unprofiled PNG; browser color-management and JPEG are not byte-exact
Pillow emulations. `show` snapshots pixels and updates one presentation per
image identity. Edits remain local until the next show or `canvas.set_image`.
`close` releases the image's host handle; the displayed snapshot retains its
own bounded lease. Guest allocations are capped at 48 MiB, dimensions at 4096
and four million pixels, encoded inputs at 8 MiB, and transfer chunks at 32 KiB.

One interactive `Canvas`/`DrawCanvas` is supported per program, plus multiple
image presentation slots. Existing positional Canvas signatures are preserved.
Images support ordinary retained movement, bounds, overlap, visibility and
stacking. Canvas adds current pointer coordinates, draining click/key queues,
text/color/font setters, and native labeled text fields, buttons, checkboxes,
integer sliders and choice groups. Control callbacks run only in Python while
`mainloop` dispatches events; no Python/JavaScript callback bridge is exposed.

`DrawCanvas` translates width/height geometry into the same retained scene.
`update()` flushes one frame; `mainloop()` waits through cancellable event reads.
Use `Canvas.pause(milliseconds)` for animation, not unsupported runtime sleep.
The original starter shells in `examples/starters` provide Baby Graphics,
Sand/Waterfall controls and a pure-Python Grid. Their `step` placeholder is where
course algorithm functions and doctests belong. These are explicit browser
adaptations, not a general Tkinter implementation or completed assignments.

### Verification

`npm run validate` checks TypeScript/CPython contracts, packed build, neutral
transport, headless workers and real CPython↔mux image transfer/save/reload with
an injected deterministic codec. Browser codec correctness is a separate gate.
`check:consumer` accepts `WEB_IDE_TARBALL` and optional `DEBUGGER_SH_TARBALL` for
an isolated packed production fixture. `?program=image_contract` tests pixels,
show/save/reload and retained sprites; `image_inputs` provides actual binary
PNG/JPEG project inputs and chromakey; `ghost_benchmark` measures nine 1000×750
inputs; `sand_benchmark` measures native controls and compact raster frames.

For compact Grid simulations, `image.set_rgb_data(bytes)` replaces the entire
image from exactly `width * height * 3` packed RGB bytes in row order. It copies
channels into the image's owned RGBA buffer and makes alpha opaque; it performs
no host request. Sand and Waterfall pack their existing Grid into one bytearray,
refresh one retained image, and subtract elapsed work from the frame pause.
The ordinary teaching Pixel and tuple APIs remain available for image algorithms.


### 0.3 lifecycle and compatibility rules

The graphics capability is version 2. A 0.3 Python helper rejects a version 1
host with a capability error; framing/multiplexer version 1 and the independent
images version 1 capability are unchanged. Historical release notes above describe
0.2 hosts only.

Every scene mutation pins referenced image revisions immediately, including inside
DrawCanvas frame batches. Publication of a replacement scene precedes releasing
removed revisions. Uploading a changed guest image releases its prior owner after
the new immutable revision commits; scene and presentation pins keep visible old
frames alive. Python garbage collection queues owner releases without performing
I/O; the next image request drains the queue. `close()` releases explicitly.

Image reads use normal guest filesystem paths (`images/a.png`, `./images/a.png`,
`/images/a.png`, and parent components). The runtime mounts workspace files at the
guest root. Saves write the real guest path, then commit a retryable download
receipt; failures release the encoded transfer, and a publication error explicitly
reports that the guest file was already saved. Output registry paths map the
absolute guest path under `/workspace`.

Companion collision detection follows case-sensitive top-level Python module
lookup. `lib/simpleimage.py` and `SimpleImage.py` do not shadow `simpleimage`.
Desktop PIL/Tk helpers remain student-owned; the host may offer an explicit
preserving rename. No helper is silently replaced.
