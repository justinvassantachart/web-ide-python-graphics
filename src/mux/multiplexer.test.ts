import { describe, expect, it, vi } from 'vitest'
import { DeviceMultiplexer } from './multiplexer'
import type { HostByteDevice, HostService, ServiceConnection } from './service'
import { GraphicsService } from '../service/graphics-service'
import { createJsonService, ServiceError } from '../transport/json-service'
import { decodeJsonObject, encodeJson } from '../protocol/codec'
import { encodeFrame, FrameReader } from '../protocol/frames'

function fakeDevice(write?: (chunk: Uint8Array) => Promise<void>) {
  const controller = new AbortController()
  let listener: ((chunk: Uint8Array) => void) | null = null
  const written: Uint8Array[] = []
  const device: HostByteDevice = {
    signal: controller.signal,
    onData(l) { listener = l; return () => { if (listener === l) listener = null } },
    async write(chunk) { await write?.(chunk); written.push(chunk.slice()) },
  }
  return {
    device, controller,
    get listening() { return listener !== null },
    feed: (channel: number, message: unknown) => listener?.(encodeFrame(channel, encodeJson(message))),
    feedBytes: (bytes: Uint8Array) => listener?.(bytes),
    responses() {
      const reader = new FrameReader()
      return written.flatMap((w) => reader.push(w)).map((f) => ({ channel: f.channel, message: decodeJsonObject(f.payload) }))
    },
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
function echo(channel = 2, capability = 'echo') {
  return createJsonService({ channel, capability, version: 1, handleRequest: (message) => ({ echo: message.value ?? null }) })
}
async function connect(services: HostService[], options: { requestTimeoutMs?: number } = {}) {
  const onFatal = vi.fn()
  const mux = new DeviceMultiplexer({ services, ...options, onFatal })
  const dev = fakeDevice()
  const cleanup = mux.opener(dev.device)
  dev.feed(0, { t: 'hello', mux: 1 })
  await tick()
  return { dev, mux, onFatal, cleanup }
}

describe('neutral shared byte transport', () => {
  it('handshakes once, validates versions, and advertises independent services', async () => {
    const handleRequest = vi.fn()
    const { dev, cleanup } = await connect([createJsonService({ channel: 1, capability: 'first', version: 2, handleRequest }), echo()])
    expect(dev.responses()[0]!.message).toEqual({ t: 'welcome', mux: 1, services: [
      { channel: 1, capability: 'first', version: 2 }, { channel: 2, capability: 'echo', version: 1 },
    ] })
    dev.feed(0, { t: 'hello', mux: 1 })
    await tick()
    expect(dev.responses()[1]!.message).toMatchObject({ t: 'error', code: 'unsupported' })
    cleanup()

    const invalid = fakeDevice()
    const mux = new DeviceMultiplexer({ services: [echo()], onFatal() {} })
    mux.opener(invalid.device)
    invalid.feed(2, { id: 1, op: 'early' })
    invalid.feed(0, { t: 'hello', mux: 99 })
    await tick()
    expect(invalid.responses().map((r) => r.message.t)).toEqual(['error', 'error'])
    invalid.controller.abort()
  })

  it('proves two independent services with alternating correlated requests', async () => {
    const { dev, cleanup } = await connect([echo(3, 'one'), echo(7, 'two')])
    for (const [channel, id, value] of [[7, 1, 'a'], [3, 2, 'b'], [7, 3, 'c']]) {
      dev.feed(channel as number, { id, op: 'echo', value })
      await tick()
    }
    expect(dev.responses().slice(1).map((r) => [r.channel, r.message.id, r.message.result])).toEqual([
      [7, 1, { echo: 'a' }], [3, 2, { echo: 'b' }], [7, 3, { echo: 'c' }],
    ])
    cleanup()
  })

  it('keeps graphics commands and request ids separate and resets on rerun', async () => {
    const graphics = new GraphicsService({ host: { requestRender() {} } })
    const { dev, mux, cleanup } = await connect([graphics, echo()])
    dev.feed(1, { op: 'add', id: 'g1', shape: 'rect', x: 0, y: 0, w: 1, h: 1 })
    dev.feed(1, { op: 'metrics', id: 1 })
    await tick()
    expect(graphics.snapshot().objects).toHaveLength(1)
    expect(dev.responses()[1]!.message).toMatchObject({ id: 1, ok: true })
    cleanup()
    const second = fakeDevice()
    mux.opener(second.device)
    expect(graphics.snapshot().objects).toHaveLength(0)
    second.controller.abort()
  })

  it('settles synchronous and asynchronous injected handler errors safely', async () => {
    const throwing: HostService = { channel: 3, capability: 'throws', version: 1, onConnect() {}, onDisconnect() {}, handleFrame() { throw new Error('secret') } }
    const rejected: HostService = { ...throwing, channel: 4, capability: 'rejects', async handleFrame() { throw new Error('credential') } }
    const safe = createJsonService({ channel: 5, capability: 'safe', version: 1, handleRequest() { throw new ServiceError('AI_DISABLED', 'AI is disabled') } })
    const { dev, cleanup } = await connect([throwing, rejected, safe, echo()])
    for (const [channel, id] of [[3, 1], [4, 2], [5, 3], [2, 4]]) {
      dev.feed(channel!, { op: 'ask', id })
      await tick()
    }
    expect(dev.responses().slice(1).map((r) => r.message)).toEqual([
      { id: 1, ok: false, error: { code: 'internal', message: 'Host service failed' } },
      { id: 2, ok: false, error: { code: 'internal', message: 'Host service failed' } },
      { id: 3, ok: false, error: { code: 'AI_DISABLED', message: 'AI is disabled' } },
      { id: 4, ok: true, result: { echo: null } },
    ])
    cleanup()
  })

  it('aborts on a second outstanding request on another channel', async () => {
    let signal: AbortSignal | undefined
    const slow = createJsonService({ channel: 3, capability: 'slow', version: 1, handleRequest(_message, context) {
      signal = context.signal
      return new Promise(() => {})
    } })
    const { dev, onFatal } = await connect([slow, echo()])
    dev.feed(3, { id: 1, op: 'wait' })
    dev.feed(2, { id: 2, op: 'echo' })
    expect(onFatal).toHaveBeenCalledOnce()
    expect(signal!.aborted).toBe(true)
    expect(dev.listening).toBe(false)
  })

  it('times out, cancels the handler, ignores late results, and permits next requests', async () => {
    let resolve!: (value: string) => void
    let signal: AbortSignal | undefined
    const slow = createJsonService({ channel: 3, capability: 'slow', version: 1, handleRequest(_message, context) {
      signal = context.signal
      return new Promise<string>((done) => { resolve = done })
    } })
    const { dev, cleanup } = await connect([slow, echo()], { requestTimeoutMs: 5 })
    dev.feed(3, { id: 1, op: 'wait' })
    await new Promise((done) => setTimeout(done, 15))
    expect(signal!.aborted).toBe(true)
    expect(dev.responses()[1]!.message).toMatchObject({ id: 1, ok: false, error: { code: 'timeout' } })
    dev.feed(2, { id: 2, op: 'echo', value: 'next' })
    resolve('late')
    await tick()
    expect(dev.responses()).toHaveLength(3)
    expect(dev.responses()[2]!.message).toMatchObject({ id: 2, ok: true })
    dev.feed(2, { id: 1, op: 'reused' })
    await tick()
    expect(dev.responses()[3]!.message).toMatchObject({ t: 'error', code: 'bad_request' })
    cleanup()
  })

  it('does not deliver an asynchronous response into a later run', async () => {
    let resolve!: (value: string) => void
    const slow = createJsonService({ channel: 2, capability: 'slow', version: 1, handleRequest() { return new Promise<string>((done) => { resolve = done }) } })
    const { dev, mux } = await connect([slow])
    dev.feed(2, { id: 1, op: 'wait' })
    const next = fakeDevice()
    const cleanup = mux.opener(next.device)
    next.feed(0, { t: 'hello', mux: 1 })
    resolve('old result')
    await tick()
    expect(dev.responses()).toHaveLength(1)
    expect(next.responses()).toHaveLength(1)
    cleanup()
  })

  it('ignores unsolicited responses, wrong-channel responses, and wrong request ids', async () => {
    let owner!: ServiceConnection
    let other!: ServiceConnection
    const make = (channel: number): HostService => ({ channel, capability: `service${channel}`, version: 1,
      onConnect(connection) { if (channel === 2) owner = connection; else other = connection }, onDisconnect() {}, handleFrame() {},
    })
    const { dev, cleanup } = await connect([make(2), make(3)])
    owner.send(encodeJson({ id: 1, ok: true }))
    dev.feed(2, { id: 1, op: 'wait' })
    other.send(encodeJson({ id: 1, ok: true }))
    owner.send(encodeJson({ id: 2, ok: true }))
    owner.send(encodeJson({ id: 1, ok: true, result: 'owned' }))
    await tick()
    expect(dev.responses()).toHaveLength(2)
    expect(dev.responses()[1]!.message.result).toBe('owned')
    cleanup()
  })

  it('detaches, aborts and disconnects deterministically on fatal framing or disposal', async () => {
    const disconnect = vi.fn()
    let signal!: AbortSignal
    const service: HostService = { channel: 2, capability: 'test', version: 1, onConnect(c) { signal = c.signal }, handleFrame() {}, onDisconnect: disconnect }
    const { dev, onFatal, cleanup } = await connect([service])
    const bad = encodeFrame(2, encodeJson({ id: 1 }))
    bad[0] = 0
    dev.feedBytes(bad)
    expect(onFatal).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(true)
    expect(dev.listening).toBe(false)
    expect(disconnect).toHaveBeenCalledOnce()
    cleanup()
    dev.controller.abort()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('stops when the bounded write queue is flooded or an awaited write fails', async () => {
    const onFatal = vi.fn()
    const dev = fakeDevice(() => new Promise(() => {}))
    new DeviceMultiplexer({ services: [], onFatal }).opener(dev.device)
    for (let i = 0; i < 70; i++) dev.feed(0, { t: 'hello', mux: 99 })
    expect(onFatal).toHaveBeenCalledOnce()
    expect(dev.listening).toBe(false)

    const failed = fakeDevice(async () => { throw new Error('closed') })
    const writeFatal = vi.fn()
    new DeviceMultiplexer({ services: [], onFatal: writeFatal }).opener(failed.device)
    failed.feed(0, { t: 'hello', mux: 1 })
    await tick()
    expect(writeFatal).toHaveBeenCalledOnce()
  })

  it('rejects invalid or ambiguous ownership metadata', () => {
    for (const channel of [0, -1, 1.5, 65536]) expect(() => new DeviceMultiplexer({ services: [echo(channel)], onFatal() {} })).toThrow()
    expect(() => new DeviceMultiplexer({ services: [echo(2), echo(3)], onFatal() {} })).toThrow(/capability/)
    expect(() => new DeviceMultiplexer({ services: [echo(2), echo(2, 'other')], onFatal() {} })).toThrow(/channel/)
    expect(() => new DeviceMultiplexer({ services: [echo(2, '')], onFatal() {} })).toThrow()
  })
  it('releases a graphics parked request when its transport deadline aborts it', async () => {
    const graphics = new GraphicsService({ host: { requestRender() {} } })
    const { dev, cleanup } = await connect([graphics], { requestTimeoutMs: 5 })
    dev.feed(1, { id: 1, op: 'pause', ms: 60000 })
    await new Promise(done => setTimeout(done, 15))
    dev.feed(1, { id: 2, op: 'metrics' })
    await tick()
    expect(dev.responses()[1]!.message).toMatchObject({ id: 1, ok: false, error: { code: 'timeout' } })
    expect(dev.responses()[2]!.message).toMatchObject({ id: 2, ok: true })
    cleanup()
  })

  it('cleans up initialization/subscription failures and skips already-aborted devices', () => {
    const disconnect = vi.fn()
    const connect = vi.fn(() => { throw new Error('failure') })
    const service: HostService = { channel: 2, capability: 'test', version: 1, onConnect: connect, handleFrame() {}, onDisconnect: disconnect }
    const onFatal = vi.fn()
    const mux = new DeviceMultiplexer({ services: [service], onFatal })
    const first = fakeDevice()
    mux.opener(first.device)
    expect(onFatal).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(first.listening).toBe(false)
    const aborted = fakeDevice()
    aborted.controller.abort()
    mux.opener(aborted.device)
    expect(connect).toHaveBeenCalledOnce()
    const broken = fakeDevice()
    broken.device.onData = () => { throw new Error('unavailable') }
    const subscriptionFatal = vi.fn()
    new DeviceMultiplexer({ services: [], onFatal: subscriptionFatal }).opener(broken.device)
    expect(subscriptionFatal).toHaveBeenCalledOnce()
  })

})
