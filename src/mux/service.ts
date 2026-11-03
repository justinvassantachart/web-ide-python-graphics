/**
 * The service/channel abstraction the multiplexer routes to. A host can supply
 * its own {@link HostService} on another channel to run an independent service
 * over the same byte device, as long as it obeys the response-only discipline
 * (it may only {@link ServiceConnection.send} in reply to a guest request on its
 * channel; never push unsolicited frames). See docs/INTEGRATION.md §0.
 */

/**
 * Structural shape of Web IDE's `RuntimeHostDevice`. Declared locally so the
 * transport/mux layer carries no runtime dependency on `web-ide`; the adapter
 * passes a real `RuntimeHostDevice`, which is assignable to this.
 */
export interface HostByteDevice {
  readonly signal: AbortSignal
  onData(listener: (chunk: Uint8Array) => void): () => void
  write(chunk: Uint8Array): Promise<void>
}

/** Per-run connection handed to a service when a run's device opens. */
export interface ServiceConnection {
  /** Aborts when the run ends (exit/stop/dispose). */
  readonly signal: AbortSignal
  /**
   * Enqueues a payload to be framed on this service's channel and written. All
   * writes across all channels are serialized by the multiplexer, so a service
   * never needs to await the previous write itself.
   */
  send(payload: Uint8Array): void
}

export interface HostService {
  readonly channel: number
  readonly capability: string
  readonly version: number
  /** Called once per run when the device opens. */
  onConnect(connection: ServiceConnection): void
  /** A complete frame payload arrived on this service's channel. */
  handleFrame(payload: Uint8Array): void
  /** Called once when the run's device aborts; freeze/cleanup, do not send. */
  onDisconnect(): void
}
