/**
 * Device multiplexer: owns one run's byte device, demultiplexes inbound frames
 * to services by channel, serializes all outbound writes, and runs the control
 * channel (hello/welcome/error). It is created once and its {@link opener} is
 * passed to `RuntimeSession.registerHostDevice`; the engine invokes the opener
 * once per run with a fresh device.
 *
 * Invariants (docs/INTEGRATION.md §0): host→guest frames are responses only;
 * unknown channels / bad payloads are recoverable (a control `error` frame),
 * only transport framing corruption tears the run's device down.
 */

import {
  CHANNEL_CONTROL,
  TRANSPORT_VERSION,
} from '../protocol/constants'
import { decodeJsonObject, encodeJson, ProtocolError } from '../protocol/codec'
import { encodeFrame, FatalFrameError, FrameReader } from '../protocol/frames'
import type { HostByteDevice, HostService, ServiceConnection } from './service'

export interface DeviceMultiplexerOptions {
  readonly services: readonly HostService[]
}

/**
 * Upper bound on outbound frames queued but not yet written. Under the
 * response-only + single-outstanding discipline this stays ~1; a larger backlog
 * means a non-conforming guest is flooding requests without reading replies, so
 * we stop (the run's device is torn down by the host when the program ends).
 */
const MAX_PENDING_WRITES = 64

export class DeviceMultiplexer {
  private readonly services = new Map<number, HostService>()

  constructor(options: DeviceMultiplexerOptions) {
    for (const service of options.services) {
      if (service.channel === CHANNEL_CONTROL) {
        throw new Error('Channel 0 is reserved for multiplexer control')
      }
      if (this.services.has(service.channel)) {
        throw new Error(`Duplicate service channel: ${service.channel}`)
      }
      this.services.set(service.channel, service)
    }
  }

  /** The opener to hand to `RuntimeSession.registerHostDevice`. */
  readonly opener = (device: HostByteDevice): (() => void) => {
    const connection = new RunConnection(device, this.services)
    return () => connection.dispose()
  }
}

/** One run's binding of the device to the registered services. */
class RunConnection {
  private readonly reader = new FrameReader()
  private writeChain: Promise<void> = Promise.resolve()
  private pendingWrites = 0
  private fatal = false
  private disposed = false
  private readonly unsubscribe: () => void

  constructor(
    private readonly device: HostByteDevice,
    private readonly services: Map<number, HostService>,
  ) {
    this.unsubscribe = device.onData((chunk) => this.onData(chunk))
    for (const service of services.values()) {
      const connection: ServiceConnection = {
        signal: device.signal,
        send: (payload) => this.sendFrame(service.channel, payload),
      }
      try {
        service.onConnect(connection)
      } catch (error) {
        console.error('[python-graphics] service onConnect failed', error)
      }
    }
    device.signal.addEventListener('abort', () => this.dispose(), { once: true })
  }

  private onData(chunk: Uint8Array): void {
    if (this.fatal || this.disposed || this.device.signal.aborted) return
    let frames
    try {
      frames = this.reader.push(chunk)
    } catch (error) {
      if (error instanceof FatalFrameError) {
        this.handleFatal(error.message)
        return
      }
      throw error
    }
    for (const frame of frames) {
      if (this.fatal) break
      this.routeFrame(frame.channel, frame.payload)
    }
  }

  private routeFrame(channel: number, payload: Uint8Array): void {
    if (channel === CHANNEL_CONTROL) {
      this.handleControl(payload)
      return
    }
    const service = this.services.get(channel)
    if (!service) {
      // Recoverable: unknown channel. Inform the guest, keep the device alive.
      this.sendControlError('bad_request', `Unknown channel ${channel}`)
      return
    }
    try {
      service.handleFrame(payload)
    } catch (error) {
      // A service-level fault is channel-local and must not crash the mux.
      console.error('[python-graphics] service handleFrame failed', error)
    }
  }

  private handleControl(payload: Uint8Array): void {
    let message: Record<string, unknown>
    try {
      message = decodeJsonObject(payload)
    } catch (error) {
      const code = error instanceof ProtocolError ? error.code : 'bad_request'
      this.sendControlError(code, 'Malformed control message')
      return
    }
    if (message.t === 'hello') {
      const services = [...this.services.values()].map((service) => ({
        channel: service.channel,
        capability: service.capability,
        version: service.version,
      }))
      this.sendFrame(CHANNEL_CONTROL, encodeJson({ t: 'welcome', mux: TRANSPORT_VERSION, services }))
      return
    }
    this.sendControlError('bad_request', `Unknown control message: ${String(message.t)}`)
  }

  private sendControlError(code: string, errorMessage: string): void {
    this.sendFrame(CHANNEL_CONTROL, encodeJson({ t: 'error', code, message: errorMessage }))
  }

  private sendFrame(channel: number, payload: Uint8Array): void {
    if (this.fatal || this.disposed) return
    if (this.pendingWrites >= MAX_PENDING_WRITES) {
      // A conforming guest keeps one request outstanding; an unbounded backlog
      // is abuse. Stop writing (the stream is effectively lost for this run).
      this.fatal = true
      console.error('[python-graphics] outbound backlog exceeded; stopping')
      return
    }
    let frame: Uint8Array
    try {
      frame = encodeFrame(channel, payload)
    } catch (error) {
      console.error('[python-graphics] frame encode failed', error)
      return
    }
    // Serialize all writes across channels; the engine rejects concurrent writes.
    this.pendingWrites++
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (this.disposed || this.device.signal.aborted) return
        await this.device.write(frame)
      } catch {
        // The device aborted mid-write (run ended); nothing to recover.
      } finally {
        this.pendingWrites--
      }
    })
  }

  private handleFatal(reason: string): void {
    if (this.fatal) return
    // Best-effort notice first (sendFrame refuses once `fatal` is set); the
    // stream is untrusted so we then stop routing. The run's device remains
    // until the host aborts it (program end / user Stop).
    this.sendControlError('bad_request', `Fatal framing error: ${reason}`)
    this.fatal = true
    console.error('[python-graphics] fatal framing error:', reason)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    for (const service of this.services.values()) {
      try {
        service.onDisconnect()
      } catch (error) {
        console.error('[python-graphics] service onDisconnect failed', error)
      }
    }
  }
}
