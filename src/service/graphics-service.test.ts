import { describe, expect, it, beforeEach } from 'vitest'
import { GraphicsService, type GraphicsScheduler } from './graphics-service'
import type { ServiceConnection } from '../mux/service'
import { encodeJson } from '../protocol/codec'

interface Pending { handle: number; cb: () => void }

function manualScheduler() {
  const pending: Pending[] = []
  let id = 1
  const scheduler: GraphicsScheduler = {
    setTimeout(cb) {
      const handle = id++
      pending.push({ handle, cb })
      return handle as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout(handle) {
      const i = pending.findIndex((p) => p.handle === (handle as unknown as number))
      if (i >= 0) pending.splice(i, 1)
    },
  }
  return { scheduler, fireAll: () => pending.splice(0).forEach((p) => p.cb()), get size() { return pending.length } }
}

function harness() {
  const timers = manualScheduler()
  const sent: Record<string, unknown>[] = []
  let renders = 0
  const controller = new AbortController()
  const service = new GraphicsService({
    scheduler: timers.scheduler,
    host: {
      requestRender: () => { renders++ },
      measureText: (object) => ({ x: object.x, y: object.y, w: object.text.length * 10, h: object.fontSize }),
    },
  })
  const connection: ServiceConnection = {
    signal: controller.signal,
    send: (payload) => sent.push(JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>),
  }
  service.onConnect(connection)
  const send = (message: unknown) => service.handleFrame(encodeJson(message))
  const sendRaw = (text: string) => service.handleFrame(new TextEncoder().encode(text))
  return { service, timers, sent, controller, send, sendRaw, renders: () => renders }
}

describe('GraphicsService', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => { h = harness() })

  it('answers the init handshake with the service version and limits', () => {
    h.send({ op: 'init', id: 1, client: 'python-graphics', version: 2 })
    expect(h.sent[0]).toMatchObject({ id: 1, ok: true, result: { service: 'graphics', version: 2 } })
    expect((h.sent[0] as { result: { limits: object } }).result.limits).toBeTruthy()
  })

  it('adds shapes into the retained scene', () => {
    h.send({ op: 'canvas', w: 400, h: 300 })
    h.send({ op: 'add', id: 'g1', shape: 'rect', x: 1, y: 2, w: 10, h: 20, fill: 'red' })
    const snapshot = h.service.snapshot()
    expect(snapshot.canvas).toMatchObject({ w: 400, h: 300 })
    expect(snapshot.objects).toHaveLength(1)
    expect(snapshot.objects[0]).toMatchObject({ kind: 'rect', x: 1, style: { fill: 'red' } })
  })

  it('clamps canvas metrics and reports them', () => {
    h.send({ op: 'canvas', w: 99999, h: 10 })
    h.send({ op: 'metrics', id: 5 })
    expect(h.sent.at(-1)).toMatchObject({ id: 5, ok: true, result: { w: 4096, h: 10 } })
  })

  it('measures shape bounds geometrically and text via the host measurer', () => {
    h.send({ op: 'add', id: 'r', shape: 'rect', x: 0, y: 0, w: 10, h: 10 })
    h.send({ op: 'bounds', id: 1, target: 'r' })
    expect(h.sent.at(-1)).toMatchObject({ id: 1, ok: true, result: { x: 0, y: 0, w: 10, h: 10 } })
    h.send({ op: 'add', id: 't', shape: 'text', x: 5, y: 6, text: 'ab' })
    h.send({ op: 'bounds', id: 2, target: 't' })
    expect(h.sent.at(-1)).toMatchObject({ id: 2, ok: true, result: { w: 20 } })
  })

  it('errors on bounds of an unknown object', () => {
    h.send({ op: 'bounds', id: 9, target: 'nope' })
    expect(h.sent.at(-1)).toMatchObject({ id: 9, ok: false, error: { code: 'unknown_object' } })
  })

  it('parks a pause and resolves it on the host timer', () => {
    h.send({ op: 'pause', id: 1, ms: 50 })
    expect(h.sent).toHaveLength(0)
    expect(h.timers.size).toBe(1)
    h.timers.fireAll()
    expect(h.sent.at(-1)).toMatchObject({ id: 1, ok: true })
  })

  it('rejects a second request while one is outstanding', () => {
    h.send({ op: 'pause', id: 1, ms: 50 })
    h.send({ op: 'metrics', id: 2 })
    expect(h.sent.at(-1)).toMatchObject({ id: 2, ok: false, error: { code: 'bad_request' } })
    h.timers.fireAll()
    expect(h.sent.at(-1)).toMatchObject({ id: 1, ok: true })
  })

  it('delivers a queued input to a parked wait_event', () => {
    h.send({ op: 'wait_event', id: 1 })
    expect(h.sent).toHaveLength(0)
    h.service.submitInput({ kind: 'mouseclick', x: 3, y: 4, button: 0 })
    expect(h.sent.at(-1)).toMatchObject({ id: 1, ok: true, result: { event: { kind: 'mouseclick', x: 3, y: 4 } } })
  })

  it('does not wedge the request gate when wait_event timeout_ms is malformed', () => {
    h.sendRaw('{"op":"wait_event","id":1,"timeout_ms":"abc"}')
    expect(h.sent.at(-1)).toMatchObject({ id: 1, ok: false, error: { code: 'bad_request' } })
    // The gate must be free: a subsequent request still succeeds.
    h.send({ op: 'metrics', id: 2 })
    expect(h.sent.at(-1)).toMatchObject({ id: 2, ok: true })
  })

  it('times out a parked wait_event with a null event', () => {
    h.send({ op: 'wait_event', id: 1, timeout_ms: 100 })
    h.timers.fireAll()
    expect(h.sent.at(-1)).toMatchObject({ id: 1, ok: true, result: { event: null } })
  })

  it('coalesces consecutive moves and drains them via poll_event', () => {
    h.service.submitInput({ kind: 'mousemove', x: 1, y: 1, button: 0 })
    h.service.submitInput({ kind: 'mousemove', x: 2, y: 2, button: 0 })
    h.send({ op: 'poll_event', id: 1 })
    expect(h.sent.at(-1)).toMatchObject({ id: 1, result: { event: { x: 2, y: 2 } } })
    h.send({ op: 'poll_event', id: 2 })
    expect(h.sent.at(-1)).toMatchObject({ id: 2, result: { event: null } })
  })

  it('drops a command carrying a non-finite number instead of applying it', () => {
    h.sendRaw('{"op":"add","id":"g1","shape":"rect","x":1e999,"y":0,"w":10,"h":10}')
    expect(h.service.snapshot().objects).toHaveLength(0)
  })

  it('ignores update props on reserved keys and does not pollute prototypes', () => {
    h.send({ op: 'add', id: 'r', shape: 'rect', x: 0, y: 0, w: 1, h: 1 })
    h.sendRaw('{"op":"update","id":"r","props":{"__proto__":{"polluted":true},"fill":"blue"}}')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(h.service.snapshot().objects[0]).toMatchObject({ style: { fill: 'blue' } })
  })

  it('drops a malformed frame without throwing', () => {
    expect(() => h.sendRaw('not json')).not.toThrow()
    expect(h.service.snapshot().objects).toHaveLength(0)
  })

  it('freezes on disconnect: no late replies, input ignored', () => {
    h.send({ op: 'pause', id: 1, ms: 50 })
    h.controller.abort()
    h.service.onDisconnect()
    h.timers.fireAll() // the parked timer was cleared
    h.service.submitInput({ kind: 'mouseclick', x: 0, y: 0, button: 0 })
    expect(h.sent).toHaveLength(0)
    expect(h.service.connected).toBe(false)
  })
  it('rejects unsupported graphics initialization versions', () => {
    h.send({ op: 'init', id: 1, version: 1 })
    expect(h.sent[0]).toMatchObject({ id: 1, ok: false, error: { code: 'unsupported' } })
  })

  it('does not let finite movement overflow a retained coordinate', () => {
    h.send({ op: 'add', id: 'r', shape: 'rect', x: 1e308, y: 0, w: 1, h: 1 })
    h.send({ op: 'move', id: 'r', dx: 1e308, dy: 0 })
    expect(h.service.snapshot().objects[0]).toMatchObject({ x: 1e308 })
  })

  it('rejects stale timer callbacks even if a scheduler runs them after cancellation', () => {
    const callbacks: (() => void)[] = []
    const service = new GraphicsService({ host: { requestRender() {} }, scheduler: {
      setTimeout(callback) { callbacks.push(callback); return 1 as unknown as ReturnType<typeof setTimeout> },
      clearTimeout() {},
    } })
    const oldReplies: Uint8Array[] = []
    service.onConnect({ signal: new AbortController().signal, send: payload => oldReplies.push(payload) })
    service.handleFrame(encodeJson({ op: 'pause', id: 1, ms: 10 }))
    service.onDisconnect()
    const newReplies: Uint8Array[] = []
    service.onConnect({ signal: new AbortController().signal, send: payload => newReplies.push(payload) })
    callbacks[0]!()
    expect(oldReplies).toHaveLength(0)
    expect(newReplies).toHaveLength(0)
  })

})

describe('image teaching graphics', () => {
  it('retains and moves image bounds without raster data in scene commands', () => {
    const h = harness()
    h.send({ op: 'add', id: 'image', shape: 'image', resourceId: 'r1', resourceVersion: 1, x: 2, y: 3, w: 20, h: 10, sampling: 'nearest' })
    h.send({ op: 'move', id: 'image', dx: 10, dy: 5 })
    h.send({ op: 'bounds', id: 1, target: 'image' })
    expect(h.sent.at(-1)).toMatchObject({ result: { x: 12, y: 8, w: 20, h: 10 } })
    h.send({ op: 'overlapping', id: 2, x1: 12, y1: 8, x2: 13, y2: 9 })
    expect(h.sent.at(-1)).toMatchObject({ result: { ids: ['image'] } })
    h.send({ op: 'visible', id: 'image', on: false })
    h.send({ op: 'overlapping', id: 3, x1: 12, y1: 8, x2: 13, y2: 9 })
    expect(h.sent.at(-1)).toMatchObject({ result: { ids: [] } })
  })

  it('reads current pointer without consuming input and drains each queue once', () => {
    const h = harness()
    h.service.submitInput({ kind: 'mousemove', x: 14, y: 28, button: 0 })
    h.service.submitInput({ kind: 'mouseclick', x: 15, y: 29, button: 0 })
    h.service.submitInput({ kind: 'keydown', key: 'a' })
    h.send({ op: 'pointer', id: 1 })
    expect(h.sent.at(-1)).toMatchObject({ result: { x: 15, y: 29 } })
    h.send({ op: 'drain_events', id: 2, kinds: ['mouseclick'] })
    expect(h.sent.at(-1)).toMatchObject({ result: { events: [{ kind: 'mouseclick' }] } })
    h.send({ op: 'drain_events', id: 3, kinds: ['mouseclick'] })
    expect(h.sent.at(-1)).toMatchObject({ result: { events: [] } })
    h.send({ op: 'drain_events', id: 4, kinds: ['keydown'] })
    expect(h.sent.at(-1)).toMatchObject({ result: { events: [{ key: 'a' }] } })
  })

  it('validates control values, records events and clears controls on rerun', () => {
    const h = harness()
    h.send({ op: 'control_add', control: { id: 'c1', kind: 'slider', label: 'Brownian', value: 20, min: 0, max: 100 } })
    h.service.submitInput({ kind: 'controlchange', controlId: 'c1', value: 101 })
    h.send({ op: 'control_value', id: 1, target: 'c1' })
    expect(h.sent.at(-1)).toMatchObject({ result: { value: 20 } })
    h.service.submitInput({ kind: 'controlchange', controlId: 'c1', value: 40 })
    h.send({ op: 'control_value', id: 2, target: 'c1' })
    expect(h.sent.at(-1)).toMatchObject({ result: { value: 40 } })
    h.service.reset()
    expect(h.service.snapshot().controls).toBeUndefined()
  })

  it('batches DrawCanvas changes until a frame flush', () => {
    const h = harness()
    const before = h.renders()
    h.send({ op: 'frame_begin' })
    h.send({ op: 'add', id: 'r1', shape: 'rect', x: 0, y: 0, w: 1, h: 1 })
    h.send({ op: 'add', id: 'r2', shape: 'rect', x: 1, y: 1, w: 1, h: 1 })
    expect(h.renders()).toBe(before)
    h.send({ op: 'flush', id: 1 })
    expect(h.renders()).toBe(before + 1)
    expect(h.sent.at(-1)).toMatchObject({ ok: true })
  })
})
