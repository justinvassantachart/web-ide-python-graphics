import { describe, expect, it } from 'vitest'
import { buildObject } from './service/build'
import { DEFAULT_CANVAS } from './model/scene'
import { LIMITS } from './protocol/constants'
import { isGraphicsInput, isSceneSnapshot, parseGraphicsInput, parseSceneSnapshot } from './validation'

const snapshot = () => ({
  canvas: { ...DEFAULT_CANVAS }, version: 3,
  objects: [
    buildObject({ id: 'rect', shape: 'rect', x: 0, y: 0, w: 5, h: 8 }),
    buildObject({ id: 'oval', shape: 'oval', x: 0, y: 0, w: 5, h: 8 }),
    buildObject({ id: 'line', shape: 'line', x1: 0, y1: 0, x2: 5, y2: 8 }),
    buildObject({ id: 'polyline', shape: 'polyline', points: [[1, 2], [3, 4]] }),
    buildObject({ id: 'polygon', shape: 'polygon', points: [[1, 2], [3, 4], [5, 6]] }),
    buildObject({ id: 'text', shape: 'text', x: 0, y: 0, text: '<b>safe text</b>', anchor: 'center' }),
  ],
})

describe('worker graphics trust boundary', () => {
  it('round-trips every shape and returns detached fields', () => {
    const source = snapshot()
    const result = parseSceneSnapshot(source)
    expect(result).toEqual(source)
    expect(result.canvas).not.toBe(source.canvas)
    expect(result.objects[3]).not.toBe(source.objects[3])
    expect(isSceneSnapshot(source)).toBe(true)
  })
  it.each([
    { canvas: { ...DEFAULT_CANVAS, background: 'url(https://bad)' } },
    { canvas: { ...DEFAULT_CANVAS, title: 'x'.repeat(257) } },
    { canvas: { ...DEFAULT_CANVAS, w: Infinity } },
    { version: -1 },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { objects: Array.from({ length: LIMITS.MAX_OBJECTS + 1 }, () => snapshot().objects[0]) },
    { objects: [snapshot().objects[0], snapshot().objects[0]] },
    { objects: Array(1) },
    { objects: [{ ...snapshot().objects[0], style: { fill: 'url(x)', outline: 'black', width: 1, opacity: 1 } }] },
    { objects: [{ ...snapshot().objects[0], x: NaN }] },
    { objects: [{ ...snapshot().objects[0], html: 'untrusted' }] },
    { objects: [{ ...snapshot().objects[3], points: [[0, Infinity]] }] },
    { objects: [{ ...snapshot().objects[5], fontFamily: 'url(x)' }] },
  ])('rejects unsafe, oversized or malformed snapshot %#', (patch) => {
    expect(() => parseSceneSnapshot({ ...snapshot(), ...patch })).toThrow()
  })
  it('does not admit unknown envelope or prototype fields', () => {
    expect(isSceneSnapshot({ ...snapshot(), extra: true })).toBe(false)
    const hostile = Object.assign(Object.create({ inherited: true }), snapshot())
    expect(isSceneSnapshot(hostile)).toBe(false)
  })
  it('bounds aggregate retained point and text storage across individually valid objects', () => {
    const line = buildObject({ id: 'line', shape: 'polyline', points: Array.from({ length: LIMITS.MAX_POINTS }, () => [0, 0]) })
    const label = buildObject({ id: 'text', shape: 'text', x: 0, y: 0, text: 'x'.repeat(LIMITS.MAX_TEXT_LEN) })
    for (const [object, count] of [
      [line, Math.floor(LIMITS.MAX_SCENE_POINTS / LIMITS.MAX_POINTS) + 1],
      [label, Math.floor(LIMITS.MAX_SCENE_TEXT_LEN / LIMITS.MAX_TEXT_LEN) + 1],
    ] as const) {
      const objects = Array.from({ length: count }, (_, index) => ({ ...object, id: String(index) }))
      expect(isSceneSnapshot({ ...snapshot(), objects })).toBe(false)
    }
  })
  it('stops decoding at the aggregate bound before touching later objects', () => {
    const line = buildObject({ id: 'line', shape: 'polyline', points: Array.from({ length: LIMITS.MAX_POINTS }, () => [0, 0]) })
    const objects = Array.from({ length: 11 }, (_, index) => ({ ...line, id: String(index) }))
    objects.push(new Proxy(line, { get() { throw new Error('late object decoded') } }))
    expect(() => parseSceneSnapshot({ ...snapshot(), objects })).toThrow('Invalid graphics snapshot or input')
  })
  it('accepts renderer keyboard and pointer events including optional undefined text', () => {
    expect(parseGraphicsInput({ kind: 'mouseclick', x: 2.5, y: -1, button: 0 })).toEqual({ kind: 'mouseclick', x: 2.5, y: -1, button: 0 })
    expect(parseGraphicsInput({ kind: 'keydown', key: 'ArrowLeft', text: undefined })).toEqual({ kind: 'keydown', key: 'ArrowLeft' })
    expect(isGraphicsInput({ kind: 'keypress', key: 'é', text: 'é' })).toBe(true)
  })
  it.each([
    { kind: 'mouseclick', x: NaN, y: 1, button: 0 },
    { kind: 'mousemove', x: 0, y: 1, button: -1 },
    { kind: 'keydown', key: 'x'.repeat(129) },
    { kind: 'keydown', key: 'a', text: 42 },
    { kind: 'keyup', key: 'a', extra: true },
    { kind: 'click', x: 1, y: 2, button: 0 },
  ])('rejects malformed input %#', (input) => {
    expect(isGraphicsInput(input)).toBe(false)
    expect(() => parseGraphicsInput(input)).toThrow()
  })
})
