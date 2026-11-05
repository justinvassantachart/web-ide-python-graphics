/** Neutral JSON service multiplexer over the public per-run byte device. */
import { CHANNEL_CONTROL, TRANSPORT_VERSION } from '../transport/constants'
import { decodeJsonObject, encodeJson } from '../protocol/codec'
import { encodeFrame, FrameReader } from '../protocol/frames'
import type { HostByteDevice, HostService, ServiceConnection, ServiceRequest } from './service'

export interface DeviceMultiplexerOptions {
  readonly services: readonly HostService[]
  /** Public byte devices cannot close themselves: stop the runtime here. */
  readonly onFatal: (error: Error) => void
  /** A host response deadline, 1..300000 ms. Default 65000 ms. */
  readonly requestTimeoutMs?: number
}

const MAX_PENDING_WRITES = 64
const MAX_REQUEST_ID = 0xffffffff
interface PendingRequest {
  readonly channel: number
  readonly id: number
  readonly controller: AbortController
  timer: ReturnType<typeof setTimeout> | null
}

export class DeviceMultiplexer {
  private readonly services = new Map<number, HostService>()
  private readonly timeoutMs: number
  private active: RunConnection | null = null

  constructor(private readonly options: DeviceMultiplexerOptions) {
    if (typeof options.onFatal !== 'function') throw new TypeError('onFatal must stop the owning runtime')
    this.timeoutMs = options.requestTimeoutMs ?? 65_000
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000) {
      throw new RangeError('requestTimeoutMs must be an integer from 1 to 300000')
    }
    const capabilities = new Set<string>()
    for (const service of options.services) {
      if (!Number.isInteger(service.channel) || service.channel < 1 || service.channel > 0xffff) {
        throw new Error('Service channel must be an integer from 1 to 65535')
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(service.capability)) {
        throw new Error('Service capability must be a nonempty bounded identifier')
      }
      if (!Number.isSafeInteger(service.version) || service.version < 1) {
        throw new Error('Service version must be a positive safe integer')
      }
      if (this.services.has(service.channel)) throw new Error(`Duplicate service channel: ${service.channel}`)
      if (capabilities.has(service.capability)) throw new Error(`Duplicate service capability: ${service.capability}`)
      capabilities.add(service.capability)
      this.services.set(service.channel, service)
    }
  }

  /** Register once on an idle RuntimeSession. One multiplexer per IDE mount. */
  readonly opener = (device: HostByteDevice): (() => void) => {
    this.active?.dispose()
    const connection = new RunConnection(device, this.services, this.timeoutMs, this.options.onFatal)
    this.active = connection
    return () => {
      connection.dispose()
      if (this.active === connection) this.active = null
    }
  }
}

class RunConnection {
  private readonly reader = new FrameReader()
  private readonly controller = new AbortController()
  private writeChain: Promise<void> = Promise.resolve()
  private pendingWrites = 0
  private disposed = false
  private welcomed = false
  private lastRequestId = 0
  private pending: PendingRequest | null = null
  private unsubscribe: () => void = () => {}
  private readonly connected: HostService[] = []
  private readonly abort = () => this.dispose()

  constructor(
    private readonly device: HostByteDevice,
    private readonly services: ReadonlyMap<number, HostService>,
    private readonly timeoutMs: number,
    private readonly onFatal: (error: Error) => void,
  ) {
    if (device.signal.aborted) {
      this.dispose()
      return
    }
    device.signal.addEventListener('abort', this.abort, { once: true })
    for (const service of services.values()) {
      const connection: ServiceConnection = {
        signal: this.controller.signal,
        send: (payload) => this.respond(service.channel, payload),
      }
      this.connected.push(service)
      try { service.onConnect(connection) } catch {
        this.fail('Service initialization failed')
        return
      }
      if (this.disposed) return
    }
    try {
      this.unsubscribe = device.onData((chunk) => this.onData(chunk))
      if (this.disposed) this.unsubscribe()
    } catch { this.fail('Host byte-device subscription failed') }
  }

  private onData(chunk: Uint8Array): void {
    if (this.disposed) return
    try {
      // Streaming consumption also bounds the number of decoded frames retained.
      this.reader.consume(chunk, (frame) => {
        if (!this.disposed) this.routeFrame(frame.channel, frame.payload)
      })
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Invalid frame')
    }
  }

  private routeFrame(channel: number, payload: Uint8Array): void {
    if (this.pending) {
      // A second request/command can deadlock a blocking byte device. Close it;
      // never queue two replies for a guest that is only reading the first.
      this.fail('Only one guest request may be outstanding across all services')
      return
    }
    let message: Record<string, unknown>
    try { message = decodeJsonObject(payload) } catch {
      this.fail('Malformed JSON service message')
      return
    }
    if (channel === CHANNEL_CONTROL) {
      if (this.welcomed || message.t !== 'hello' || message.mux !== TRANSPORT_VERSION) {
        this.controlError('unsupported', 'Expected one hello with mux version 1')
        return
      }
      this.welcomed = true
      this.enqueue(CHANNEL_CONTROL, encodeJson({
        t: 'welcome', mux: TRANSPORT_VERSION,
        services: [...this.services.values()].map(({ channel: ch, capability, version }) => ({ channel: ch, capability, version })),
      }))
      return
    }
    if (!this.welcomed) {
      this.controlError('bad_request', 'Complete the transport handshake first')
      return
    }
    const service = this.services.get(channel)
    if (!service) {
      if (typeof message.id === 'number') this.controlError('bad_request', `Unknown channel ${channel}`)
      else this.fail(`Unknown command channel ${channel}`)
      return
    }
    // The v1 JSON profile reserves numeric ids for requests; command object ids
    // remain strings. Monotonic ids prevent stale callbacks stealing a reply.
    let request: PendingRequest | null = null
    if (typeof message.id === 'number') {
      if (!Number.isInteger(message.id) || message.id <= this.lastRequestId || message.id > MAX_REQUEST_ID) {
        this.controlError('bad_request', 'Request ids must increase from 1 through 4294967295')
        return
      }
      this.lastRequestId = message.id
      request = { channel, id: message.id, controller: new AbortController(), timer: null }
      this.pending = request
      const current = request
      request.timer = setTimeout(() => {
        if (this.pending !== current) return
        this.respond(channel, encodeJson({ id: current.id, ok: false, error: { code: 'timeout', message: 'Host request timed out' } }), current)
      }, this.timeoutMs)
    }
    const context: ServiceRequest | undefined = request ? {
      id: request.id,
      signal: request.controller.signal,
      send: (body) => this.respond(channel, body, request),
    } : undefined
    const rejected = () => {
      if (request && this.pending === request) {
        this.respond(channel, encodeJson({ id: request.id, ok: false, error: { code: 'internal', message: 'Host service failed' } }), request)
      }
      // A command has no reply slot. Throwing commands terminate the run so the
      // next service cannot consume an unexpected control error.
      else if (!request) this.fail('Host command failed')
    }
    try {
      const result = service.handleFrame(payload, context)
      if (result) void Promise.resolve(result).catch(rejected)
    } catch { rejected() }
  }

  private respond(channel: number, payload: Uint8Array, expected?: PendingRequest | null): void {
    const pending = this.pending
    if (this.disposed || !pending || (expected && expected !== pending) || pending.channel !== channel) return
    let message: Record<string, unknown>
    try { message = decodeJsonObject(payload) } catch {
      this.fail('Host service produced invalid JSON')
      return
    }
    if (message.id !== pending.id) return // stale/unowned/unsolicited reply
    if (typeof message.ok !== 'boolean') {
      this.fail('Host service produced an invalid response envelope')
      return
    }
    this.pending = null
    if (pending.timer !== null) clearTimeout(pending.timer)
    pending.controller.abort()
    this.enqueue(channel, payload)
  }

  private controlError(code: string, message: string): void {
    this.enqueue(CHANNEL_CONTROL, encodeJson({ t: 'error', code, message }))
  }

  private enqueue(channel: number, payload: Uint8Array): void {
    if (this.disposed) return
    if (this.pendingWrites >= MAX_PENDING_WRITES) {
      this.fail('Outbound response queue exceeded its limit')
      return
    }
    let frame: Uint8Array
    try { frame = encodeFrame(channel, payload) } catch {
      this.fail('Host response exceeded its frame limit')
      return
    }
    this.pendingWrites++
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (!this.disposed) await this.device.write(frame)
      } catch { this.fail('Host byte-device write failed') }
      finally { this.pendingWrites-- }
    })
  }

  private fail(message: string): void {
    if (this.disposed) return
    this.dispose()
    // The runtime owns device closure; its public stop() releases a blocked read.
    this.onFatal(new Error(message))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.device.signal.removeEventListener('abort', this.abort)
    this.controller.abort()
    if (this.pending) {
      if (this.pending.timer !== null) clearTimeout(this.pending.timer)
      this.pending.controller.abort()
      this.pending = null
    }
    for (const service of this.connected) {
      try { service.onDisconnect() } catch { /* cleanup must reach every service */ }
    }
    this.connected.length = 0
  }
}
