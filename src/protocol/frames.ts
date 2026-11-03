/**
 * Transport framing: 8-byte header + payload, length-prefixed, big-endian.
 * Both directions use the same format. The reader accumulates arbitrary byte
 * chunks (the engine delivers ≤64 KiB wakes / partial reads) and yields complete
 * frames, enforcing {@link LIMITS.MAX_FRAME_BYTES} before buffering a payload.
 */

import {
  FRAME_HEADER_BYTES,
  FRAME_MAGIC,
  LIMITS,
  TRANSPORT_VERSION,
} from './constants'

export interface Frame {
  readonly channel: number
  readonly payload: Uint8Array
}

/**
 * Unrecoverable framing error. The byte stream can no longer be trusted, so the
 * connection (this run's device) must be torn down. Not channel-recoverable.
 */
export class FatalFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalFrameError'
  }
}

/** Encodes one frame. Throws if the payload exceeds the frame bound. */
export function encodeFrame(channel: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffff) {
    throw new RangeError(`Frame channel out of range: ${channel}`)
  }
  if (payload.length > LIMITS.MAX_FRAME_BYTES) {
    throw new RangeError(
      `Frame payload ${payload.length} exceeds MAX_FRAME_BYTES ${LIMITS.MAX_FRAME_BYTES}`,
    )
  }
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.length)
  const view = new DataView(frame.buffer)
  view.setUint8(0, FRAME_MAGIC)
  view.setUint8(1, TRANSPORT_VERSION)
  view.setUint16(2, channel, false)
  view.setUint32(4, payload.length, false)
  frame.set(payload, FRAME_HEADER_BYTES)
  return frame
}

/**
 * Incremental frame reader. `push` returns any frames completed by the new
 * bytes and throws {@link FatalFrameError} on a corrupt/oversized header. Memory
 * is bounded by `FRAME_HEADER_BYTES + MAX_FRAME_BYTES`: a header is validated
 * (and its length bound checked) before the payload is allowed to accumulate.
 */
export class FrameReader {
  // Pending bytes not yet consumed into a frame. Kept as a single buffer that
  // is compacted as frames are consumed; bounded by the frame limit above.
  private buffer = new Uint8Array(0)

  push(chunk: Uint8Array): Frame[] {
    if (chunk.length === 0) return []
    this.append(chunk)
    return this.drain()
  }

  /** Bytes currently buffered (awaiting a complete frame). */
  get pendingBytes(): number {
    return this.buffer.length
  }

  private append(chunk: Uint8Array): void {
    if (this.buffer.length === 0) {
      this.buffer = chunk.slice()
      return
    }
    const next = new Uint8Array(this.buffer.length + chunk.length)
    next.set(this.buffer, 0)
    next.set(chunk, this.buffer.length)
    this.buffer = next
  }

  private drain(): Frame[] {
    const frames: Frame[] = []
    let offset = 0
    while (this.buffer.length - offset >= FRAME_HEADER_BYTES) {
      const view = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset + offset,
        FRAME_HEADER_BYTES,
      )
      const magic = view.getUint8(0)
      const version = view.getUint8(1)
      if (magic !== FRAME_MAGIC) {
        throw new FatalFrameError(
          `Bad frame magic 0x${magic.toString(16)} (expected 0x${FRAME_MAGIC.toString(16)})`,
        )
      }
      if (version !== TRANSPORT_VERSION) {
        throw new FatalFrameError(
          `Unsupported transport version ${version} (expected ${TRANSPORT_VERSION})`,
        )
      }
      const channel = view.getUint16(2, false)
      const length = view.getUint32(4, false)
      if (length > LIMITS.MAX_FRAME_BYTES) {
        throw new FatalFrameError(
          `Frame length ${length} exceeds MAX_FRAME_BYTES ${LIMITS.MAX_FRAME_BYTES}`,
        )
      }
      const frameEnd = offset + FRAME_HEADER_BYTES + length
      if (this.buffer.length < frameEnd) break // wait for the rest of the payload
      const payloadStart = offset + FRAME_HEADER_BYTES
      frames.push({ channel, payload: this.buffer.slice(payloadStart, frameEnd) })
      offset = frameEnd
    }
    if (offset > 0) {
      this.buffer = this.buffer.slice(offset)
    }
    return frames
  }
}
