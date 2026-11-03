import { describe, expect, it } from 'vitest'
import { encodeFrame, FatalFrameError, FrameReader } from './frames'
import { CHANNEL_GRAPHICS, FRAME_HEADER_BYTES, LIMITS } from './constants'

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

describe('frame codec', () => {
  it('round-trips a frame', () => {
    const payload = new TextEncoder().encode('{"op":"ping"}')
    const frame = encodeFrame(CHANNEL_GRAPHICS, payload)
    const [parsed] = new FrameReader().push(frame)
    expect(parsed?.channel).toBe(CHANNEL_GRAPHICS)
    expect(new TextDecoder().decode(parsed!.payload)).toBe('{"op":"ping"}')
  })

  it('reassembles a frame split across arbitrary chunks', () => {
    const payload = new TextEncoder().encode('x'.repeat(200))
    const frame = encodeFrame(7, payload)
    const reader = new FrameReader()
    const frames = []
    for (let i = 0; i < frame.length; i += 5) {
      frames.push(...reader.push(frame.subarray(i, i + 5)))
    }
    expect(frames).toHaveLength(1)
    expect(frames[0]!.payload).toHaveLength(200)
    expect(reader.pendingBytes).toBe(0)
  })

  it('yields multiple frames delivered in one chunk', () => {
    const a = encodeFrame(1, new TextEncoder().encode('a'))
    const b = encodeFrame(2, new TextEncoder().encode('bb'))
    const frames = new FrameReader().push(concat([a, b]))
    expect(frames.map((f) => f.channel)).toEqual([1, 2])
  })

  it('waits for an incomplete payload without emitting', () => {
    const frame = encodeFrame(1, new TextEncoder().encode('hello'))
    const reader = new FrameReader()
    expect(reader.push(frame.subarray(0, FRAME_HEADER_BYTES + 2))).toEqual([])
    expect(reader.push(frame.subarray(FRAME_HEADER_BYTES + 2))).toHaveLength(1)
  })

  it('rejects a bad magic byte as fatal', () => {
    const frame = encodeFrame(1, new Uint8Array([1]))
    frame[0] = 0x00
    expect(() => new FrameReader().push(frame)).toThrow(FatalFrameError)
  })

  it('rejects an unknown version as fatal', () => {
    const frame = encodeFrame(1, new Uint8Array([1]))
    frame[1] = 9
    expect(() => new FrameReader().push(frame)).toThrow(FatalFrameError)
  })

  it('rejects an oversize declared length as fatal before buffering', () => {
    const header = new Uint8Array(FRAME_HEADER_BYTES)
    const view = new DataView(header.buffer)
    view.setUint8(0, 0xc7)
    view.setUint8(1, 1)
    view.setUint16(2, 1, false)
    view.setUint32(4, LIMITS.MAX_FRAME_BYTES + 1, false)
    expect(() => new FrameReader().push(header)).toThrow(/MAX_FRAME_BYTES/)
  })

  it('refuses to encode an oversize payload', () => {
    expect(() => encodeFrame(1, new Uint8Array(LIMITS.MAX_FRAME_BYTES + 1))).toThrow(/MAX_FRAME_BYTES/)
  })
})
