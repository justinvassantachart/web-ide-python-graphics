/**
 * JSON payload codec for channels that carry JSON (control + graphics). Payload
 * size is already bounded by the frame reader; decoding adds UTF-8 + JSON
 * validation. Parsing itself is prototype-safe (JSON.parse writes own
 * properties, never the prototype); callers must still avoid copying untrusted
 * keys onto host objects — the service layer does field-by-field allow-listing.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/** Recoverable, channel-local protocol error (bad payload/JSON/validation). */
export class ProtocolError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/**
 * Decodes a JSON object payload. Throws {@link ProtocolError} (recoverable) on
 * empty payload, invalid UTF-8, invalid JSON, or a non-object top level.
 */
export function decodeJsonObject(payload: Uint8Array): Record<string, unknown> {
  if (payload.length === 0) {
    throw new ProtocolError('bad_request', 'Empty JSON payload')
  }
  let text: string
  try {
    text = decoder.decode(payload)
  } catch {
    throw new ProtocolError('bad_request', 'Payload is not valid UTF-8')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ProtocolError('bad_request', 'Payload is not valid JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('bad_request', 'JSON payload must be an object')
  }
  return value as Record<string, unknown>
}
