import { describe, expect, it } from 'vitest'
import { DeviceMultiplexer } from './multiplexer'
import type { HostByteDevice, HostService, ServiceConnection } from './service'
import { GraphicsService } from '../service/graphics-service'
import { CHANNEL_CONTROL, CHANNEL_GRAPHICS } from '../protocol/constants'
import { decodeJsonObject, encodeJson } from '../protocol/codec'
import { encodeFrame, FrameReader } from '../protocol/frames'

function fakeDevice() {
  const controller = new AbortController()
  let listener: ((chunk: Uint8Array) => void) | null = null
  const written: Uint8Array[] = []
  const device: HostByteDevice = {
    signal: controller.signal,
    onData(l) {
      listener = l
      return () => { if (listener === l) listener = null }
    },
    async write(chunk) { written.push(chunk.slice()) },
  }
  return {
    device,
    controller,
    feed: (channel: number, message: unknown) => listener?.(encodeFrame(channel, encodeJson(message))),
    feedBytes: (bytes: Uint8Array) => listener?.(bytes),
    responses() {
      const reader = new FrameReader()
      const frames = written.flatMap((w) => reader.push(w))
      return frames.map((f) => ({ channel: f.channel, message: decodeJsonObject(f.payload) }))
    },
  }
}

/** A minimal response-only second service used to prove multiplexing. */
class EchoService implements HostService {
  readonly channel = 2
  readonly capability = 'echo'
  readonly version = 1
  connects = 0
  disconnects = 0
  private connection: ServiceConnection | null = null
  onConnect(connection: ServiceConnection): void { this.connection = connection; this.connects++ }
  handleFrame(payload: Uint8Array): void {
    const message = decodeJsonObject(payload)
    if (typeof message.id === 'number') {
      this.connection?.send(encodeJson({ id: message.id, ok: true, result: { echo: message.value ?? null } }))
    }
  }
  onDisconnect(): void { this.disconnects++; this.connection = null }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup() {
  const graphics = new GraphicsService({ host: { requestRender: () => {} } })
  const echo = new EchoService()
  const mux = new DeviceMultiplexer({ services: [graphics, echo] })
  return { graphics, echo, mux }
}

describe('DeviceMultiplexer (shared host device)', () => {
  it('answers the control handshake with every registered service', async () => {
    const { mux } = setup()
    const dev = fakeDevice()
    mux.opener(dev.device)
    dev.feed(CHANNEL_CONTROL, { t: 'hello', mux: 1 })
    await tick()
    expect(dev.responses()).toEqual([
      {
        channel: CHANNEL_CONTROL,
        message: {
          t: 'welcome',
          mux: 1,
          services: [
            { channel: 1, capability: 'graphics', version: 1 },
            { channel: 2, capability: 'echo', version: 1 },
          ],
        },
      },
    ])
  })

  it('routes requests to the owning channel and keeps responses on that channel', async () => {
    const { mux } = setup()
    const dev = fakeDevice()
    mux.opener(dev.device)
    dev.feed(CHANNEL_GRAPHICS, { op: 'init', id: 1, client: 'x', version: 1 })
    dev.feed(2, { id: 7, value: 'hi' })
    await tick()
    const responses = dev.responses()
    expect(responses.find((r) => r.channel === CHANNEL_GRAPHICS)?.message).toMatchObject({ id: 1, ok: true })
    expect(responses.find((r) => r.channel === 2)?.message).toMatchObject({ id: 7, ok: true, result: { echo: 'hi' } })
  })

  it('applies graphics commands to the scene over the device', async () => {
    const { graphics, mux } = setup()
    const dev = fakeDevice()
    mux.opener(dev.device)
    dev.feed(CHANNEL_GRAPHICS, { op: 'canvas', w: 200, h: 100 })
    dev.feed(CHANNEL_GRAPHICS, { op: 'add', id: 'g1', shape: 'oval', x: 0, y: 0, w: 20, h: 20, fill: 'gold' })
    await tick()
    expect(graphics.snapshot().objects).toHaveLength(1)
  })

  it('treats an unknown channel as recoverable, not a teardown', async () => {
    const { echo, mux } = setup()
    const dev = fakeDevice()
    mux.opener(dev.device)
    dev.feed(5, { id: 1 }) // no service on channel 5
    dev.feed(2, { id: 2, value: 'ok' }) // echo still works afterwards
    await tick()
    const responses = dev.responses()
    expect(responses.some((r) => r.channel === CHANNEL_CONTROL && r.message.t === 'error')).toBe(true)
    expect(responses.some((r) => r.channel === 2)).toBe(true)
    expect(dev.device.signal.aborted).toBe(false)
    expect(echo.disconnects).toBe(0)
  })

  it('emits a control error on fatal framing corruption', async () => {
    const { mux } = setup()
    const dev = fakeDevice()
    mux.opener(dev.device)
    const bad = encodeFrame(1, encodeJson({ op: 'init', id: 1 }))
    bad[0] = 0x00 // corrupt the magic byte
    dev.feedBytes(bad)
    await tick()
    expect(dev.responses().some((r) => r.channel === CHANNEL_CONTROL && r.message.t === 'error')).toBe(true)
  })

  it('disconnects every service when the run aborts', async () => {
    const { graphics, echo, mux } = setup()
    const dev = fakeDevice()
    mux.opener(dev.device)
    expect(echo.connects).toBe(1)
    dev.controller.abort()
    expect(echo.disconnects).toBe(1)
    expect(graphics.connected).toBe(false)
  })

  it('resets the graphics scene on each new run (per-run isolation)', async () => {
    const { graphics, mux } = setup()
    const first = fakeDevice()
    mux.opener(first.device)
    first.feed(CHANNEL_GRAPHICS, { op: 'add', id: 'g1', shape: 'rect', x: 0, y: 0, w: 1, h: 1 })
    await tick()
    expect(graphics.snapshot().objects).toHaveLength(1)
    first.controller.abort()

    const second = fakeDevice()
    mux.opener(second.device)
    expect(graphics.snapshot().objects).toHaveLength(0)
  })

  it('rejects a service on the reserved control channel', () => {
    const bad: HostService = { channel: CHANNEL_CONTROL, capability: 'x', version: 1, onConnect() {}, handleFrame() {}, onDisconnect() {} }
    expect(() => new DeviceMultiplexer({ services: [bad] })).toThrow()
  })
})
