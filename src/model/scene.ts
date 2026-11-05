/**
 * Retained scene model: an ordered set of immutable object records (array order
 * is z-order, first = back) plus an id index for O(1) lookup/replace. Pure and
 * DOM-free so it is unit-testable; the renderer projects a snapshot and the
 * service mutates it. Text metrics are the only geometry the model cannot
 * compute (they need the DOM), so {@link geometricBounds} returns null for text.
 */

import { finiteNumber, type Bounds, type Point, type TextAnchor } from './geometry'
import { LIMITS } from '../protocol/constants'
import { ProtocolError } from '../protocol/codec'

export interface Style {
  readonly fill: string // 'none' or a validated safe color
  readonly outline: string // 'none' or a validated safe color
  readonly width: number // stroke width, >= 0
  readonly opacity: number // 0..1
}

interface ObjectBase {
  readonly id: string
  readonly visible: boolean
  readonly style: Style
}

export type SceneObject =
  | (ObjectBase & { readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number })
  | (ObjectBase & { readonly kind: 'polyline'; readonly points: readonly Point[] })
  | (ObjectBase & { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number })
  | (ObjectBase & { readonly kind: 'oval'; readonly x: number; readonly y: number; readonly w: number; readonly h: number })
  | (ObjectBase & { readonly kind: 'polygon'; readonly points: readonly Point[] })
  | (ObjectBase & {
      readonly kind: 'text'
      readonly x: number
      readonly y: number
      readonly text: string
      readonly anchor: TextAnchor
      readonly fontSize: number
      readonly fontFamily: string
    })

export type ObjectKind = SceneObject['kind']

export interface CanvasState {
  readonly w: number
  readonly h: number
  readonly background: string
  /** Accessible label; rendered as text content only, never as HTML. */
  readonly title: string
}

export type OrderMode = 'front' | 'back' | 'forward' | 'backward'

export interface SceneSnapshot {
  readonly canvas: CanvasState
  readonly objects: readonly SceneObject[]
  readonly version: number
}

export const DEFAULT_CANVAS: CanvasState = { w: 300, h: 200, background: 'white', title: '' }

/** The reference point used by `moveTo` and relative moves. */
export function objectReferencePoint(object: SceneObject): Point {
  switch (object.kind) {
    case 'line':
      return [object.x1, object.y1]
    case 'rect':
    case 'oval':
    case 'text':
      return [object.x, object.y]
    case 'polyline':
    case 'polygon':
      return object.points[0] ?? [0, 0]
  }
}

/** Returns a translated copy of an object (all coordinates shifted). */
export function translateObject(object: SceneObject, dx: number, dy: number): SceneObject {
  switch (object.kind) {
    case 'line':
      return { ...object, x1: finiteNumber(object.x1 + dx, 'translated x1'), y1: finiteNumber(object.y1 + dy, 'translated y1'), x2: finiteNumber(object.x2 + dx, 'translated x2'), y2: finiteNumber(object.y2 + dy, 'translated y2') }
    case 'rect':
    case 'oval':
    case 'text':
      return { ...object, x: finiteNumber(object.x + dx, 'translated x'), y: finiteNumber(object.y + dy, 'translated y') }
    case 'polyline':
    case 'polygon':
      return { ...object, points: object.points.map(([px, py]) => [finiteNumber(px + dx, 'translated x'), finiteNumber(py + dy, 'translated y')] as Point) }
  }
}

/** Geometric bounds for every shape except text (which needs measurement). */
export function geometricBounds(object: SceneObject): Bounds | null {
  switch (object.kind) {
    case 'line':
      return boundsOfPoints([[object.x1, object.y1], [object.x2, object.y2]])
    case 'rect':
    case 'oval':
      return normalizeRect(object.x, object.y, object.w, object.h)
    case 'polyline':
    case 'polygon':
      return boundsOfPoints(object.points)
    case 'text':
      return null
  }
}

function normalizeRect(x: number, y: number, w: number, h: number): Bounds {
  return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) }
}

function boundsOfPoints(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of points) {
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Mutable retained scene. All mutations bump {@link version}. */
export class Scene {
  private _canvas: CanvasState = DEFAULT_CANVAS
  private readonly order: SceneObject[] = []
  private readonly index = new Map<string, number>()
  private _version = 0
  private pointCount = 0
  private textLength = 0

  get version(): number {
    return this._version
  }

  get canvas(): CanvasState {
    return this._canvas
  }

  get size(): number {
    return this.order.length
  }

  has(id: string): boolean {
    return this.index.has(id)
  }

  getById(id: string): SceneObject | undefined {
    const position = this.index.get(id)
    return position === undefined ? undefined : this.order[position]
  }

  snapshot(): SceneSnapshot {
    return { canvas: this._canvas, objects: this.order.slice(), version: this._version }
  }

  setCanvas(canvas: CanvasState): void {
    this._canvas = canvas
    this.order.length = 0
    this.index.clear()
    this.pointCount = 0
    this.textLength = 0
    this._version++
  }

  clearObjects(): void {
    if (this.order.length === 0) return
    this.order.length = 0
    this.index.clear()
    this.pointCount = 0
    this.textLength = 0
    this._version++
  }

  add(object: SceneObject): void {
    this.adjustBudget(object)
    this.index.set(object.id, this.order.length)
    this.order.push(object)
    this._version++
  }

  private adjustBudget(next?: SceneObject, previous?: SceneObject): void {
    const points = (object?: SceneObject) => object?.kind === 'polyline' || object?.kind === 'polygon' ? object.points.length : 0
    const text = (object?: SceneObject) => object?.kind === 'text' ? object.text.length : 0
    const nextPoints = this.pointCount + points(next) - points(previous)
    const nextText = this.textLength + text(next) - text(previous)
    if (nextPoints > LIMITS.MAX_SCENE_POINTS || nextText > LIMITS.MAX_SCENE_TEXT_LEN) {
      throw new ProtocolError('limit_exceeded', 'Scene aggregate geometry or text limit exceeded')
    }
    this.pointCount = nextPoints
    this.textLength = nextText
  }

  /** Replaces an existing object in place (same z-position). */
  replace(object: SceneObject): void {
    const position = this.index.get(object.id)
    if (position === undefined) return
    this.adjustBudget(object, this.order[position])
    this.order[position] = object
    this._version++
  }

  remove(id: string): void {
    const position = this.index.get(id)
    if (position === undefined) return
    this.adjustBudget(undefined, this.order[position])
    this.order.splice(position, 1)
    this.index.delete(id)
    this.reindexFrom(position)
    this._version++
  }

  reorder(id: string, mode: OrderMode): void {
    const from = this.index.get(id)
    if (from === undefined) return
    const last = this.order.length - 1
    let to = from
    if (mode === 'front') to = last
    else if (mode === 'back') to = 0
    else if (mode === 'forward') to = Math.min(last, from + 1)
    else if (mode === 'backward') to = Math.max(0, from - 1)
    if (to === from) return
    const [object] = this.order.splice(from, 1)
    this.order.splice(to, 0, object!)
    this.reindexFrom(Math.min(from, to))
    this._version++
  }

  private reindexFrom(start: number): void {
    for (let i = start; i < this.order.length; i++) {
      this.index.set(this.order[i]!.id, i)
    }
  }
}
