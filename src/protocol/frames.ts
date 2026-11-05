/**
 * Transport framing: 8-byte header + payload, length-prefixed, big-endian.
 * Both directions use the same format. The reader accumulates arbitrary byte
 * chunks (the engine delivers ≤64 KiB wakes / partial reads) and yields complete
 * frames, enforcing {@link MAX_FRAME_BYTES} before buffering a payload.
 */

import {
  FRAME_HEADER_BYTES,
  FRAME_MAGIC,
  MAX_FRAME_BYTES,
  TRANSPORT_VERSION,
} from '../transport/constants'

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
  if (payload.length > MAX_FRAME_BYTES) {
    throw new RangeError(
      `Frame payload ${payload.length} exceeds MAX_FRAME_BYTES ${MAX_FRAME_BYTES}`,
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
  private readonly header = new Uint8Array(FRAME_HEADER_BYTES)
  private headerBytes = 0
  private payload: Uint8Array | null = null
  private payloadBytes = 0
  private channel = 0

  push(chunk: Uint8Array): Frame[] {
    const frames: Frame[] = []
    this.consume(chunk, (frame) => frames.push(frame))
    return frames
  }

  /** Processes frames as they complete, without accumulating a frame queue. */
  consume(chunk: Uint8Array, receive: (frame: Frame) => void): void {
    let offset = 0
    while (offset < chunk.length) {
      if (this.headerBytes < FRAME_HEADER_BYTES) {
        const length = Math.min(FRAME_HEADER_BYTES - this.headerBytes, chunk.length - offset)
        this.header.set(chunk.subarray(offset, offset + length), this.headerBytes)
        this.headerBytes += length
        offset += length
        if (this.headerBytes < FRAME_HEADER_BYTES) return
        const view = new DataView(this.header.buffer)
        if (view.getUint8(0) !== FRAME_MAGIC) throw new FatalFrameError('Bad frame magic')
        if (view.getUint8(1) !== TRANSPORT_VERSION) throw new FatalFrameError('Unsupported transport version')
        this.channel = view.getUint16(2, false)
        const size = view.getUint32(4, false)
        if (size > MAX_FRAME_BYTES) {
          throw new FatalFrameError(`Frame length ${size} exceeds MAX_FRAME_BYTES ${MAX_FRAME_BYTES}`)
        }
        // The length is checked before allocating or copying any payload.
        this.payload = new Uint8Array(size)
      }
      const payload = this.payload!
      const length = Math.min(payload.length - this.payloadBytes, chunk.length - offset)
      payload.set(chunk.subarray(offset, offset + length), this.payloadBytes)
      this.payloadBytes += length
      offset += length
      if (this.payloadBytes < payload.length) return
      const frame = { channel: this.channel, payload }
      this.headerBytes = 0
      this.payloadBytes = 0
      this.payload = null
      receive(frame)
    }
  }

  get pendingBytes(): number {
    return this.headerBytes + this.payloadBytes
  }
}
