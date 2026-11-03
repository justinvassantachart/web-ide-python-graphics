# Integration & versioned wire contract — @web-ide/python-graphics

This is the **binding** contract between the Python guest helper and the host
renderer, and the handoff a host agrees to when composing an additional service
on the shared byte device. Design rationale lives in `DESIGN.md`.

- Transport version: **1** (`FRAME_MAGIC = 0xC7`, `TRANSPORT_VERSION = 1`).
- Graphics service: capability `graphics`, **version 1**.
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
3. **Fatal vs recoverable.** Bad `MAGIC`, unknown `VERSION`, or
   `LENGTH > MAX_FRAME_BYTES` are fatal (the run's device is torn down —
   per-run, per-instance). Unknown channel, empty payload, bad JSON, or any
   service validation failure is recoverable (a control `error` frame; the
   device and other services survive).
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
8      LEN  PAYLOAD (UTF-8 JSON for channels 0 and 1)
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
| 2..255  | host-injected services  |

Control (channel 0), JSON: guest→host `{"t":"hello","mux":1}`; host→guest
`{"t":"welcome","mux":1,"services":[{"channel":1,"capability":"graphics","version":1}, …]}`;
host→guest `{"t":"error","code":"…","message":"…"}`.

## 2. Graphics service (channel 1, JSON, v1)

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

Text length is measured in UTF-16 code units (the Python client counts the same
so astral characters cannot slip past it).

**Images: no API in v1.** There is deliberately no image op — the protocol and
the Python `Canvas` cannot express one — so there is no URL fetch and no image
decode, which is why uncontrolled URLs and unbounded decoding are not a concern.
The `unsupported` error code is **reserved** for the planned follow-up: a
bounded, host-approved asset registry addressed by an opaque id (never a
guest-controlled URL), with a hard pixel-dimension cap.

### Object identity, batching, and the final image

- **Object id lifetime.** Ids are opaque strings (≤128 chars) allocated by the
  guest. The Python client allocates monotonically (`g1`, `g2`, …) and never
  reuses an id within a run, including after `delete`. The host rejects a
  duplicate `add` (`duplicate_object`) and a mutation of an unknown id, and ids
  do not survive a run: a new run resets the scene, so the id space restarts.
- **Batch atomicity.** v1 has **no multi-command transaction**. Commands apply
  individually in arrival order; there is no all-or-nothing batch and no partial
  rollback. What is guaranteed is ordering: when the guest yields (any request —
  `pause`/`wait_event`/`poll_event`/`bounds`/`metrics` — or program exit), every
  command it sent beforehand has been applied to the scene. The renderer coalesces
  repaints (one per microtask), so between yields intermediate states may or may
  not paint; use `pause` to pace animation deterministically. A future explicit
  `begin`/`commit` batch op is possible behind the version handshake but is not in
  v1.
- **Final image.** When a run ends (program exit or Stop → device `signal`
  abort), the last applied scene remains displayed (frozen) until the next run's
  first `canvas`/`add`, which resets it.

## 3. Test vectors

Bytes (hex) produced by `encodeFrame(channel, encodeJson(message))`. A conforming
implementation MUST **parse** these frames. JSON object-key order is **not**
normative, so an implementation's own output may differ byte-for-byte (the
Python client appends `op`/`id` last, for example); both sides key by name. The
8-byte header and the payload's decoded JSON are the authoritative part.

```
control hello      ch0  {"t":"hello","mux":1}
  c7010000000000157b2274223a2268656c6c6f222c226d7578223a317d

control welcome    ch0  {"t":"welcome","mux":1,"services":[{"channel":1,"capability":"graphics","version":1}]}
  c7010000000000567b2274223a2277656c636f6d65222c226d7578223a312c227365727669636573...

graphics init req  ch1  {"op":"init","id":1,"client":"python-graphics","version":1}
  c70100010000003b7b226f70223a22696e6974222c226964223a312c22636c69656e74223a22707974686f6e2d6772617068696373222c2276657273696f6e223a317d

graphics init resp ch1  {"id":1,"ok":true,"result":{"service":"graphics","version":1,"limits":{"maxObjects":10000,"maxPoints":10000,"maxTextLen":4096,"maxCanvasDim":4096,"maxPauseMs":60000}}}
  c7010001000000a77b226964223a312c226f6b223a747275652c22726573756c74223a7b2273657276696365223a226772617068696373222c2276657273696f6e223a312c226c696d697473223a7b226d61784f626a65637473223a31303030302c226d6178506f696e7473223a31303030302c226d6178546578744c656e223a343039362c226d617843616e76617344696d223a343039362c226d617850617573654d73223a36303030307d7d7d

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

## 4. Handoff for an additional service (consumer agreement)

A host composing a second service over the one device agrees:

- It claims a channel `≥ 2` (graphics is always 1, control is 0). Channel
  assignment is static per composition and agreed with that service's own guest
  client out of band.
- It owns the framing of its channel's payloads (the multiplexer only frames and
  routes; it does not interpret non-graphics payloads).
- It obeys the response-only, single-outstanding discipline (invariant §0.1) —
  no unsolicited host→guest writes.
- All writes across channels are serialized by the multiplexer; a transport
  framing error (invariant §0.3) tears down the shared device for that run.

The multiplexer frames and routes **opaque** payloads; it does not parse a
second service's messages and so cannot enforce that service's response-only /
single-outstanding discipline. The outbound backlog cap (64 queued frames) is
the backstop that bounds the damage a misbehaving service can do to the shared
blocking stream; honoring §0.1 is the injected service's responsibility under
this contract.

Composition entry points:
`createPythonGraphicsPlugin({ createAdditionalServices })` for the Web IDE
plugin, or construct a `DeviceMultiplexer({ services: [graphicsService, …] })`
yourself and pass `multiplexer.opener` to `RuntimeSession.registerHostDevice`.

## 5. Web IDE integration specifics

- The Python helper ships as an **execution-only** resource package at guest
  `/graphics/__init__.py` (+ `/graphics/turtle.py`). `graphics` and
  `graphics.turtle` are **reserved module names**; a workspace file named
  `graphics.py` is shadowed by the package (it does not break the run).
- The plugin registers one host-device opener in `activate` while the session is
  idle, bridges the per-run controller to the panel through a session-keyed
  reactive registry, and disposes both on deactivate. End-of-run is the device
  `signal` abort; the final image is retained until the next run.
- Panel id `web-ide.python-graphics`, title **Graphics** (do not reuse the
  built-in `canvasPlugin` id `canvas`). Keyboard is captured only while the
  canvas is focused.
