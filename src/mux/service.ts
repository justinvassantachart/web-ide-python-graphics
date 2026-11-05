/** Public structural subset of Web IDE's RuntimeHostDevice. */
export interface HostByteDevice {
  readonly signal: AbortSignal
  onData(listener: (chunk: Uint8Array) => void): () => void
  /** Resolves after the entire chunk is written; calls must be serialized. */
  write(chunk: Uint8Array): Promise<void>
}

/** One run's connection. A service may send only a correlated response. */
export interface ServiceConnection {
  readonly signal: AbortSignal
  send(payload: Uint8Array): void
}

/** A request-specific connection; aborted on reply, timeout, or run teardown. */
export interface ServiceRequest extends ServiceConnection {
  readonly id: number
}

export interface HostService {
  readonly channel: number
  readonly capability: string
  readonly version: number
  onConnect(connection: ServiceConnection): void
  handleFrame(payload: Uint8Array, request?: ServiceRequest): void | Promise<void>
  onDisconnect(): void
}
