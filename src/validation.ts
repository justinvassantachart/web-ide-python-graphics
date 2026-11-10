/** Public trust-boundary decoders for hosts that carry graphics across workers. */
import { parseControl, MAX_CONTROLS } from './model/controls'
import { isSafeColor } from './model/color'
import { finiteNumber } from './model/geometry'
import type { SceneObject, SceneSnapshot } from './model/scene'
import { LIMITS } from './protocol/constants'
import { ProtocolError } from './protocol/codec'
import { buildObject } from './service/build'
import type { GraphicsInput } from './service/events'

function fail(): never {
  throw new ProtocolError('bad_request', 'Invalid graphics snapshot or input')
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) return fail()
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) fail()
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) return fail()
  return value
}
function color(value: unknown): string {
  if (typeof value !== 'string' || (value !== 'none' && !isSafeColor(value))) return fail()
  return value
}
function range(value: unknown, min: number, max: number): number {
  const number = finiteNumber(value, 'value')
  if (number < min || number > max) return fail()
  return number
}
function sceneObject(value: unknown): SceneObject {
  const object = record(value)
  const style = record(object.style)
  keys(style, ['fill', 'outline', 'width', 'opacity'])
  if (typeof object.visible !== 'boolean') return fail()
  const base = ['id', 'kind', 'visible', 'style']
  const payload: Record<string, unknown> = {
    id: object.id, shape: object.kind, visible: object.visible,
    fill: color(style.fill), outline: color(style.outline),
    width: range(style.width, 0, LIMITS.MAX_STROKE_WIDTH),
    opacity: range(style.opacity, 0, 1),
  }
  switch (object.kind) {
    case 'image':
      keys(object, [...base, 'x', 'y', 'w', 'h', 'resourceId', 'resourceVersion', 'sampling'])
      for (const key of ['x', 'y', 'w', 'h', 'resourceId', 'resourceVersion', 'sampling']) payload[key] = object[key]
      break
    case 'line':
      keys(object, [...base, 'x1', 'y1', 'x2', 'y2'])
      for (const key of ['x1', 'y1', 'x2', 'y2']) payload[key] = object[key]
      break
    case 'rect': case 'oval':
      keys(object, [...base, 'x', 'y', 'w', 'h'])
      for (const key of ['x', 'y', 'w', 'h']) payload[key] = object[key]
      break
    case 'polygon': case 'polyline':
      keys(object, [...base, 'points'])
      payload.points = object.points
      break
    case 'text':
      keys(object, [...base, 'x', 'y', 'text', 'anchor', 'fontSize', 'fontFamily'])
      if (typeof object.anchor !== 'string' || typeof object.fontFamily !== 'string') return fail()
      payload.x = object.x
      payload.y = object.y
      payload.text = object.text
      payload.anchor = object.anchor
      payload.font_size = range(object.fontSize, Number.MIN_VALUE, LIMITS.MAX_FONT_SIZE)
      payload.font_family = object.fontFamily
      break
    default: return fail()
  }
  return buildObject(payload)
}

/** Returns a detached validated snapshot; throws ProtocolError on invalid data. */
export function parseSceneSnapshot(value: unknown): SceneSnapshot {
  const snapshot = record(value)
  keys(snapshot, Object.hasOwn(snapshot, 'controls') ? ['canvas', 'objects', 'version', 'controls'] : ['canvas', 'objects', 'version'])
  let controls
  if (snapshot.controls !== undefined) {
    if (!Array.isArray(snapshot.controls) || snapshot.controls.length > MAX_CONTROLS) return fail()
    controls = snapshot.controls.map(parseControl)
    if (new Set(controls.map(v => v.id)).size !== controls.length) return fail()
  }
  const canvas = record(snapshot.canvas)
  keys(canvas, ['w', 'h', 'background', 'title'])
  if (!Number.isSafeInteger(snapshot.version) || (snapshot.version as number) < 0) return fail()
  if (!Array.isArray(snapshot.objects) || snapshot.objects.length > LIMITS.MAX_OBJECTS) return fail()
  const objects: SceneObject[] = []
  const ids = new Set<string>()
  let totalPoints = 0
  let totalText = 0
  // Validate and budget incrementally: never clone an entire hostile scene
  // before discovering its aggregate geometry/text exceeds the retained bound.
  // for..of visits sparse array slots as undefined, which sceneObject rejects.
  for (const value of snapshot.objects) {
    const object = sceneObject(value)
    if (object.kind === 'polygon' || object.kind === 'polyline') totalPoints += object.points.length
    if (object.kind === 'text') totalText += object.text.length
    if (totalPoints > LIMITS.MAX_SCENE_POINTS || totalText > LIMITS.MAX_SCENE_TEXT_LEN || ids.has(object.id)) return fail()
    ids.add(object.id)
    objects.push(object)
  }
  return {
    canvas: {
      w: range(canvas.w, 1, LIMITS.MAX_CANVAS_DIM),
      h: range(canvas.h, 1, LIMITS.MAX_CANVAS_DIM),
      background: color(canvas.background), title: text(canvas.title, 256),
    },
    objects, version: snapshot.version as number, ...(controls ? { controls } : {}),
  }
}

export function isSceneSnapshot(value: unknown): value is SceneSnapshot {
  try { parseSceneSnapshot(value); return true } catch { return false }
}

/** Returns only allowed input fields; coordinates remain in logical canvas units. */
export function parseGraphicsInput(value: unknown): GraphicsInput {
  const input = record(value)
  switch (input.kind) {
    case 'controlchange': case 'controlsubmit': case 'controlclick': {
      keys(input, ['kind', 'controlId', 'value'])
      if (typeof input.value !== 'boolean' && typeof input.value !== 'string' && typeof input.value !== 'number') return fail()
      if (typeof input.value === 'string' && input.value.length > 4096) return fail()
      if (typeof input.value === 'number' && !Number.isSafeInteger(input.value)) return fail()
      return { kind: input.kind, controlId: text(input.controlId, 128), value: input.value }
    }
    case 'mousedown': case 'mouseup': case 'mouseclick': case 'mousemove': case 'mousedrag': {
      keys(input, ['kind', 'x', 'y', 'button'])
      // PointerEvent permits auxiliary buttons beyond the usual left/middle/right.
      const button = range(input.button, 0, 31)
      if (!Number.isInteger(button)) return fail()
      return { kind: input.kind, x: finiteNumber(input.x, 'x'), y: finiteNumber(input.y, 'y'), button }
    }
    case 'keydown': case 'keyup': case 'keypress': {
      keys(input, Object.hasOwn(input, 'text') ? ['kind', 'key', 'text'] : ['kind', 'key'])
      const key = text(input.key, 128)
      if (key.length === 0) return fail()
      return { kind: input.kind, key, ...(input.text === undefined ? {} : { text: text(input.text, 128) }) }
    }
    default: return fail()
  }
}

export function isGraphicsInput(value: unknown): value is GraphicsInput {
  try { parseGraphicsInput(value); return true } catch { return false }
}
