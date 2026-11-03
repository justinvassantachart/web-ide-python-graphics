/**
 * Numeric and geometry validation at the trust boundary. Every number coming
 * from guest JSON must pass {@link finiteNumber} (JSON.parse turns `1e999` into
 * Infinity without throwing), and every collection is bounded.
 */

import { LIMITS } from '../protocol/constants'
import { ProtocolError } from '../protocol/codec'

export type Point = readonly [number, number]

export const TEXT_ANCHORS = [
  'nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se',
] as const
export type TextAnchor = (typeof TEXT_ANCHORS)[number]

export function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProtocolError('bad_request', `${field} must be a finite number`)
  }
  return value
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Validates a non-negative finite number (sizes, radii). */
export function nonNegative(value: unknown, field: string): number {
  const n = finiteNumber(value, field)
  if (n < 0) throw new ProtocolError('bad_request', `${field} must be >= 0`)
  return n
}

/** Validates and clamps a stroke width. */
export function strokeWidth(value: unknown, field: string): number {
  return clamp(nonNegative(value, field), 0, LIMITS.MAX_STROKE_WIDTH)
}

/** Validates an opacity in [0, 1]. */
export function opacity(value: unknown, field: string): number {
  return clamp(finiteNumber(value, field), 0, 1)
}

/** Validates a bounded array of finite [x, y] points. */
export function validatePoints(value: unknown, field: string): Point[] {
  if (!Array.isArray(value)) {
    throw new ProtocolError('bad_request', `${field} must be an array of points`)
  }
  if (value.length > LIMITS.MAX_POINTS) {
    throw new ProtocolError('limit_exceeded', `${field} exceeds MAX_POINTS`)
  }
  const points: Point[] = []
  for (let i = 0; i < value.length; i++) {
    const raw = value[i]
    if (!Array.isArray(raw) || raw.length !== 2) {
      throw new ProtocolError('bad_request', `${field}[${i}] must be [x, y]`)
    }
    points.push([finiteNumber(raw[0], `${field}[${i}].x`), finiteNumber(raw[1], `${field}[${i}].y`)])
  }
  return points
}

export function validateAnchor(value: unknown): TextAnchor {
  if (value === undefined || value === null) return 'nw'
  if (typeof value !== 'string' || !TEXT_ANCHORS.includes(value as TextAnchor)) {
    throw new ProtocolError('bad_request', `anchor must be one of ${TEXT_ANCHORS.join(', ')}`)
  }
  return value as TextAnchor
}

/** Axis-aligned bounding box in logical units. */
export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Positions a `w`×`h` box whose anchor point sits at (`x`,`y`), returning the
 * top-left corner. Shared by the DOM-free text-bounds estimate and the live
 * renderer measurement so both agree on anchor semantics.
 */
export function anchoredBox(
  anchor: TextAnchor,
  x: number,
  y: number,
  w: number,
  h: number,
): Bounds {
  const left = anchor === 'nw' || anchor === 'w' || anchor === 'sw' ? x
    : anchor === 'ne' || anchor === 'e' || anchor === 'se' ? x - w
      : x - w / 2
  const top = anchor === 'nw' || anchor === 'n' || anchor === 'ne' ? y
    : anchor === 'sw' || anchor === 's' || anchor === 'se' ? y - h
      : y - h / 2
  return { x: left, y: top, w, h }
}
