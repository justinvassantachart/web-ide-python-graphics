/**
 * Versioned transport + graphics-service constants. These are the binding wire
 * contract (see docs/INTEGRATION.md). Changing any value here is a protocol
 * change: bump {@link TRANSPORT_VERSION} for framing/channel changes or
 * {@link GRAPHICS_VERSION} for graphics message changes, and keep the Python
 * helper (`src/python/graphics/__init__.py`) in lockstep.
 */

import { MAX_FRAME_BYTES } from '../transport/constants'
export { FRAME_MAGIC, TRANSPORT_VERSION, FRAME_HEADER_BYTES, CHANNEL_CONTROL } from '../transport/constants'

/** Default graphics-service channel. */
export const CHANNEL_GRAPHICS = 1

/** Graphics service capability name advertised in the mux handshake. */
export const GRAPHICS_CAPABILITY = 'graphics'

/** Graphics service protocol version. */
export const GRAPHICS_VERSION = 2

/**
 * Hard bounds enforced identically on both sides of the trust boundary. A guest
 * that exceeds any of these is misbehaving and is rejected, never applied.
 */
export const LIMITS = {
  /** Max payload bytes in one frame (header excluded). Bounds reader buffers. */
  MAX_FRAME_BYTES,
  /** Max retained objects in a scene. */
  MAX_OBJECTS: 10_000,
  /** Max points in a polyline/polygon. */
  MAX_POINTS: 10_000,
  /** Aggregate retained polyline/polygon vertices across the entire scene. */
  MAX_SCENE_POINTS: 100_000,
  /** Aggregate retained text size in UTF-16 units across the entire scene. */
  MAX_SCENE_TEXT_LEN: 1_048_576,
  /** Max characters in a text object. */
  MAX_TEXT_LEN: 4_096,
  /** Max canvas width/height in logical units. */
  MAX_CANVAS_DIM: 4_096,
  /** Max host-timed pause / event timeout in milliseconds. */
  MAX_PAUSE_MS: 60_000,
  /** Max buffered input events before the oldest are dropped. */
  MAX_EVENT_QUEUE: 512,
  /** Max concurrently parked (awaiting) requests. The guest is synchronous. */
  MAX_PARKED_REQUESTS: 1,
  /** Max text font size in logical units (render-DoS guard). */
  MAX_FONT_SIZE: 512,
  /** Max stroke width in logical units (render-DoS guard). */
  MAX_STROKE_WIDTH: 512,
} as const

export type Limits = typeof LIMITS

/** Stable error codes returned to the guest. */
export const ERROR_CODES = {
  BAD_REQUEST: 'bad_request',
  UNKNOWN_OBJECT: 'unknown_object',
  DUPLICATE_OBJECT: 'duplicate_object',
  TOO_MANY_OBJECTS: 'too_many_objects',
  LIMIT_EXCEEDED: 'limit_exceeded',
  UNSUPPORTED: 'unsupported',
  INTERNAL: 'internal',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
