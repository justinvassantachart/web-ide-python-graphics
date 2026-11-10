/**
 * Builds and updates {@link SceneObject}s from guest JSON under the trust
 * boundary. Every field is read explicitly from a fixed allow-list and
 * validated; guest keys are never spread or merged onto host objects, so an
 * object id or property named `__proto__`/`constructor` cannot pollute a
 * prototype, and `Infinity`/`NaN` from `JSON.parse` is rejected.
 */

import { LIMITS } from '../protocol/constants'
import { ProtocolError } from '../protocol/codec'
import { validateColor } from '../model/color'
import {
  finiteNumber,
  nonNegative,
  opacity as readOpacity,
  strokeWidth,
  validateAnchor,
  validatePoints,
} from '../model/geometry'
import type { Style, SceneObject } from '../model/scene'

const FONT_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy'])
const SHAPES = new Set(['line', 'polyline', 'rect', 'oval', 'polygon', 'text', 'image'])

function requireString(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== 'string') throw new ProtocolError('bad_request', `${field} must be a string`)
  if (value.length > maxLen) throw new ProtocolError('limit_exceeded', `${field} exceeds ${maxLen} characters`)
  return value
}

function has(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function readFontFamily(value: unknown): string {
  if (value === undefined || value === null) return 'sans-serif'
  if (typeof value !== 'string' || !FONT_FAMILIES.has(value)) {
    throw new ProtocolError('bad_request', `font_family must be one of ${[...FONT_FAMILIES].join(', ')}`)
  }
  return value
}

function readFontSize(value: unknown): number {
  if (value === undefined || value === null) return 16
  const n = finiteNumber(value, 'font_size')
  if (n <= 0) throw new ProtocolError('bad_request', 'font_size must be > 0')
  return Math.min(n, LIMITS.MAX_FONT_SIZE)
}

function buildStyle(
  payload: Record<string, unknown>,
  defaults: { fill: string; outline: string; width: number },
): Style {
  return {
    fill: has(payload, 'fill') ? validateColor(payload.fill, 'fill') : defaults.fill,
    outline: has(payload, 'outline') ? validateColor(payload.outline, 'outline') : defaults.outline,
    width: has(payload, 'width') ? strokeWidth(payload.width, 'width') : defaults.width,
    opacity: has(payload, 'opacity') ? readOpacity(payload.opacity, 'opacity') : 1,
  }
}

export function validateObjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ProtocolError('bad_request', 'object id must be a string of 1..128 characters')
  }
  return value
}

/** Builds a validated object from an `add` payload. */
export function buildObject(payload: Record<string, unknown>): SceneObject {
  const id = validateObjectId(payload.id)
  const shape = payload.shape
  if (typeof shape !== 'string' || !SHAPES.has(shape)) {
    throw new ProtocolError('bad_request', `unknown shape: ${String(shape)}`)
  }
  const visible = has(payload, 'visible') ? Boolean(payload.visible) : true
  const shapeDefaults = { fill: 'none', outline: 'black', width: 1 }

  switch (shape) {
    case 'image': {
      const resourceId = validateObjectId(payload.resourceId)
      if (!Number.isSafeInteger(payload.resourceVersion) || (payload.resourceVersion as number) < 1) throw new ProtocolError('bad_request', 'invalid image version')
      if (payload.sampling !== undefined && payload.sampling !== 'nearest' && payload.sampling !== 'smooth') throw new ProtocolError('bad_request', 'invalid image sampling')
      return { id, kind: 'image', visible, style: buildStyle(payload, { fill: 'none', outline: 'none', width: 0 }),
        x: finiteNumber(payload.x, 'x'), y: finiteNumber(payload.y, 'y'), w: nonNegative(payload.w, 'w'), h: nonNegative(payload.h, 'h'),
        resourceId, resourceVersion: payload.resourceVersion as number, sampling: payload.sampling === 'nearest' ? 'nearest' : 'smooth' }
    }
    case 'line':
      return {
        id, kind: 'line', visible, style: buildStyle(payload, shapeDefaults),
        x1: finiteNumber(payload.x1, 'x1'), y1: finiteNumber(payload.y1, 'y1'),
        x2: finiteNumber(payload.x2, 'x2'), y2: finiteNumber(payload.y2, 'y2'),
      }
    case 'polyline':
      return { id, kind: 'polyline', visible, style: buildStyle(payload, shapeDefaults), points: validatePoints(payload.points, 'points') }
    case 'polygon':
      return { id, kind: 'polygon', visible, style: buildStyle(payload, shapeDefaults), points: validatePoints(payload.points, 'points') }
    case 'rect':
      return {
        id, kind: 'rect', visible, style: buildStyle(payload, shapeDefaults),
        x: finiteNumber(payload.x, 'x'), y: finiteNumber(payload.y, 'y'),
        w: nonNegative(payload.w, 'w'), h: nonNegative(payload.h, 'h'),
      }
    case 'oval':
      return {
        id, kind: 'oval', visible, style: buildStyle(payload, shapeDefaults),
        x: finiteNumber(payload.x, 'x'), y: finiteNumber(payload.y, 'y'),
        w: nonNegative(payload.w, 'w'), h: nonNegative(payload.h, 'h'),
      }
    case 'text':
      return {
        id, kind: 'text', visible,
        style: buildStyle(payload, { fill: 'black', outline: 'none', width: 0 }),
        x: finiteNumber(payload.x, 'x'), y: finiteNumber(payload.y, 'y'),
        text: requireString(payload.text, 'text', LIMITS.MAX_TEXT_LEN),
        anchor: validateAnchor(payload.anchor),
        fontSize: readFontSize(payload.font_size),
        fontFamily: readFontFamily(payload.font_family),
      }
    default:
      throw new ProtocolError('bad_request', `unknown shape: ${shape}`)
  }
}

/** Applies a validated `update` patch, returning a new object record. */
export function applyUpdate(current: SceneObject, props: unknown): SceneObject {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    throw new ProtocolError('bad_request', 'update props must be an object')
  }
  const patch = props as Record<string, unknown>
  const style = updateStyle(current.style, patch)
  let next: SceneObject = { ...current, style }

  switch (current.kind) {
    case 'image': {
      const resourceId = has(patch, 'resourceId') ? validateObjectId(patch.resourceId) : current.resourceId
      const version = has(patch, 'resourceVersion') ? patch.resourceVersion : current.resourceVersion
      if (!Number.isSafeInteger(version) || (version as number) < 1) throw new ProtocolError('bad_request', 'invalid image version')
      next = { ...current, style, resourceId, resourceVersion: version as number,
        x: has(patch, 'x') ? finiteNumber(patch.x, 'x') : current.x,
        y: has(patch, 'y') ? finiteNumber(patch.y, 'y') : current.y,
        w: has(patch, 'w') ? nonNegative(patch.w, 'w') : current.w,
        h: has(patch, 'h') ? nonNegative(patch.h, 'h') : current.h }
      break
    }
    case 'line':
      next = {
        ...next, kind: 'line',
        x1: has(patch, 'x1') ? finiteNumber(patch.x1, 'x1') : current.x1,
        y1: has(patch, 'y1') ? finiteNumber(patch.y1, 'y1') : current.y1,
        x2: has(patch, 'x2') ? finiteNumber(patch.x2, 'x2') : current.x2,
        y2: has(patch, 'y2') ? finiteNumber(patch.y2, 'y2') : current.y2,
      }
      break
    case 'rect':
    case 'oval':
      next = {
        ...next, kind: current.kind,
        x: has(patch, 'x') ? finiteNumber(patch.x, 'x') : current.x,
        y: has(patch, 'y') ? finiteNumber(patch.y, 'y') : current.y,
        w: has(patch, 'w') ? nonNegative(patch.w, 'w') : current.w,
        h: has(patch, 'h') ? nonNegative(patch.h, 'h') : current.h,
      }
      break
    case 'polyline':
    case 'polygon':
      next = { ...next, kind: current.kind, points: has(patch, 'points') ? validatePoints(patch.points, 'points') : current.points }
      break
    case 'text':
      next = {
        ...next, kind: 'text',
        x: has(patch, 'x') ? finiteNumber(patch.x, 'x') : current.x,
        y: has(patch, 'y') ? finiteNumber(patch.y, 'y') : current.y,
        text: has(patch, 'text') ? requireString(patch.text, 'text', LIMITS.MAX_TEXT_LEN) : current.text,
        anchor: has(patch, 'anchor') ? validateAnchor(patch.anchor) : current.anchor,
        fontSize: has(patch, 'font_size') ? readFontSize(patch.font_size) : current.fontSize,
        fontFamily: has(patch, 'font_family') ? readFontFamily(patch.font_family) : current.fontFamily,
      }
      break
  }
  return next
}

function updateStyle(current: Style, patch: Record<string, unknown>): Style {
  return {
    fill: has(patch, 'fill') ? validateColor(patch.fill, 'fill') : current.fill,
    outline: has(patch, 'outline') ? validateColor(patch.outline, 'outline') : current.outline,
    width: has(patch, 'width') ? strokeWidth(patch.width, 'width') : current.width,
    opacity: has(patch, 'opacity') ? readOpacity(patch.opacity, 'opacity') : current.opacity,
  }
}
