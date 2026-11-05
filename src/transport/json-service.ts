import type { HostService, ServiceRequest } from '../mux/service'
import { decodeJsonObject, encodeJson } from '../protocol/codec'

/** An intentionally safe error to expose to the guest. Codes remain unchanged. */
export class ServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
  }
}

export interface JsonServiceOptions {
  readonly channel: number
  readonly capability: string
  readonly version: number
  handleRequest(message: Record<string, unknown>, context: { readonly signal: AbortSignal }): unknown | Promise<unknown>
}

/** Response-only JSON service with request-scoped cancellation and safe errors. */
export function createJsonService(options: JsonServiceOptions): HostService {
  return {
    channel: options.channel,
    capability: options.capability,
    version: options.version,
    onConnect() {},
    onDisconnect() {},
    async handleFrame(payload: Uint8Array, request?: ServiceRequest) {
      if (!request || request.signal.aborted) return
      try {
        const result = await options.handleRequest(decodeJsonObject(payload), { signal: request.signal })
        if (!request.signal.aborted) request.send(encodeJson({ id: request.id, ok: true, result }))
      } catch (error) {
        if (!request.signal.aborted) {
          const safe = error instanceof ServiceError ? error : new ServiceError('internal', 'Host service failed')
          request.send(encodeJson({ id: request.id, ok: false, error: { code: safe.code, message: safe.message } }))
        }
      }
    },
  }
}
