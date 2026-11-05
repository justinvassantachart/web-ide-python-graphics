import { describe, expect, it } from 'vitest'
import { LIMITS } from '../protocol/constants'
import {
  geometricBounds,
  objectReferencePoint,
  Scene,
  translateObject,
  type SceneObject,
  type Style,
} from './scene'

const style: Style = { fill: 'red', outline: 'black', width: 1, opacity: 1 }

function rect(id: string, x = 0, y = 0, w = 10, h = 10): SceneObject {
  return { id, kind: 'rect', visible: true, style, x, y, w, h }
}

describe('Scene', () => {
  it('adds in z-order and indexes by id', () => {
    const scene = new Scene()
    scene.add(rect('a'))
    scene.add(rect('b'))
    expect(scene.snapshot().objects.map((o) => o.id)).toEqual(['a', 'b'])
    expect(scene.getById('b')?.id).toBe('b')
    expect(scene.has('missing')).toBe(false)
  })

  it('replaces in place without changing z-position', () => {
    const scene = new Scene()
    scene.add(rect('a'))
    scene.add(rect('b'))
    scene.replace(rect('a', 5, 5))
    const objects = scene.snapshot().objects
    expect(objects.map((o) => o.id)).toEqual(['a', 'b'])
    expect((objects[0] as { x: number }).x).toBe(5)
  })

  it('removes and keeps the index consistent', () => {
    const scene = new Scene()
    scene.add(rect('a'))
    scene.add(rect('b'))
    scene.add(rect('c'))
    scene.remove('a')
    expect(scene.snapshot().objects.map((o) => o.id)).toEqual(['b', 'c'])
    scene.replace(rect('c', 9))
    expect((scene.getById('c') as { x: number }).x).toBe(9)
  })

  it('reorders front/back/forward/backward', () => {
    const scene = new Scene()
    for (const id of ['a', 'b', 'c']) scene.add(rect(id))
    scene.reorder('a', 'front')
    expect(scene.snapshot().objects.map((o) => o.id)).toEqual(['b', 'c', 'a'])
    scene.reorder('a', 'back')
    expect(scene.snapshot().objects.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    scene.reorder('a', 'forward')
    expect(scene.snapshot().objects.map((o) => o.id)).toEqual(['b', 'a', 'c'])
    scene.reorder('a', 'backward')
    expect(scene.snapshot().objects.map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('bumps version on every mutation and resets on setCanvas', () => {
    const scene = new Scene()
    const v0 = scene.version
    scene.add(rect('a'))
    expect(scene.version).toBeGreaterThan(v0)
    scene.setCanvas({ w: 100, h: 100, background: 'white', title: '' })
    expect(scene.size).toBe(0)
  })

  it('tolerates a prototype-polluting id without polluting Object', () => {
    const scene = new Scene()
    scene.add(rect('__proto__'))
    expect(scene.getById('__proto__')?.id).toBe('__proto__')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})

describe('aggregate scene budgets', () => {
  const poly = (id: string, count: number): SceneObject => ({ id, kind: 'polyline', visible: true, style, points: Array.from({ length: count }, () => [0, 0]) })
  const label = (id: string, count: number): SceneObject => ({ id, kind: 'text', visible: true, style, x: 0, y: 0, text: 'x'.repeat(count), anchor: 'nw', fontSize: 12, fontFamily: 'serif' })

  it('rejects adds and updates atomically, frees removed geometry, and resets counts', () => {
    const scene = new Scene()
    for (let i = 0; i < 10; i++) scene.add(poly(`p${i}`, LIMITS.MAX_POINTS))
    const before = scene.snapshot()
    expect(() => scene.add(poly('overflow', 1))).toThrow(/aggregate/)
    expect(scene.snapshot()).toEqual(before)
    scene.remove('p0')
    scene.add(poly('replacement', LIMITS.MAX_POINTS))
    expect(() => scene.replace(poly('replacement', LIMITS.MAX_POINTS + 1))).toThrow(/aggregate/)
    scene.clearObjects()
    scene.add(poly('fresh', LIMITS.MAX_POINTS))
    expect(scene.size).toBe(1)
  })

  it('bounds aggregate text independently and permits shrinking/reuse', () => {
    const scene = new Scene()
    for (let i = 0; i < 256; i++) scene.add(label(`t${i}`, LIMITS.MAX_TEXT_LEN))
    expect(() => scene.add(label('overflow', 1))).toThrow(/aggregate/)
    scene.replace(label('t0', 0))
    scene.add(label('replacement', LIMITS.MAX_TEXT_LEN))
    expect(scene.size).toBe(257)
  })
})

describe('geometry transforms', () => {
  it('translates each shape by a delta', () => {
    expect(translateObject(rect('a', 1, 2), 3, 4)).toMatchObject({ x: 4, y: 6 })
    const line: SceneObject = { id: 'l', kind: 'line', visible: true, style, x1: 0, y1: 0, x2: 2, y2: 2 }
    expect(translateObject(line, 1, 1)).toMatchObject({ x1: 1, y1: 1, x2: 3, y2: 3 })
  })

  it('reports reference points and bounds', () => {
    expect(objectReferencePoint(rect('a', 5, 6))).toEqual([5, 6])
    expect(geometricBounds(rect('a', 0, 0, 10, 20))).toEqual({ x: 0, y: 0, w: 10, h: 20 })
    const poly: SceneObject = { id: 'p', kind: 'polygon', visible: true, style, points: [[0, 0], [10, 0], [5, 8]] }
    expect(geometricBounds(poly)).toEqual({ x: 0, y: 0, w: 10, h: 8 })
    const text: SceneObject = { id: 't', kind: 'text', visible: true, style, x: 0, y: 0, text: 'x', anchor: 'nw', fontSize: 12, fontFamily: 'serif' }
    expect(geometricBounds(text)).toBeNull()
  })
})
