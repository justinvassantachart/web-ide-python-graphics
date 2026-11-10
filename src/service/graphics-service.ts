/**
 * The graphics {@link HostService}. It owns a retained {@link Scene}, validates
 * every inbound frame, applies commands in arrival order, and answers requests
 * (init/metrics/bounds/pause/wait_event/poll_event) as the single response to a
 * prior guest request. Input events are pulled by the guest, never pushed.
 *
 * Deadlock-safety (docs/INTEGRATION.md §0): at most one request may be
 * outstanding; a second concurrent request is rejected. pause/wait_event park on
 * an injected timer and are abandoned (no late reply) when the run's device
 * aborts.
 */

import { CHANNEL_GRAPHICS, ERROR_CODES, GRAPHICS_CAPABILITY, GRAPHICS_VERSION, LIMITS } from '../protocol/constants'
import { decodeJsonObject, encodeJson, ProtocolError } from '../protocol/codec'
import { validateColor } from '../model/color'
import { anchoredBox, clamp, finiteNumber, type Bounds } from '../model/geometry'
import {
  DEFAULT_CANVAS,
  geometricBounds,
  objectReferencePoint,
  Scene,
  translateObject,
  type CanvasState,
  type OrderMode,
  type SceneObject,
  type SceneSnapshot,
} from '../model/scene'
import { parseControl, MAX_CONTROLS, type ControlDescriptor } from '../model/controls'
import { applyUpdate, buildObject } from './build'
import { isCoalescible, type GraphicsInput } from './events'
import type { HostService, ServiceConnection, ServiceRequest } from '../mux/service'

type TimerHandle = ReturnType<typeof setTimeout>

export interface GraphicsScheduler {
  setTimeout(callback: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

const defaultScheduler: GraphicsScheduler = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
}

export interface GraphicsServiceHost {
  /** The scene changed; schedule a repaint. */
  requestRender(): void
  /** Pin references on every mutation, even while visual publication is batched. */
  onSceneMutation?(): void
  validateImage?(resourceId: string, version: number): void
  /** Measure text bounds via the live renderer; null when unavailable. */
  measureText?(object: SceneObject & { kind: 'text' }): Bounds | null
  /** The run's device opened (scene has been reset). */
  onConnected?(): void
  /** The guest applied its first graphics command this run (it uses graphics). */
  onFirstCommand?(): void
  /** The run's device aborted; the last frame is frozen. */
  onDisconnected?(): void
}

export interface GraphicsServiceOptions {
  readonly host: GraphicsServiceHost
  readonly channel?: number
  readonly scheduler?: GraphicsScheduler
}

const REQUEST_OPS = new Set(['init', 'metrics', 'bounds', 'pause', 'wait_event', 'poll_event', 'pointer', 'drain_events', 'overlapping', 'object', 'control_value', 'flush'])

interface Parked {
  kind: 'event' | 'pause'
  id: number
  timer: TimerHandle | null
  detachAbort?: () => void
}

export class GraphicsService implements HostService {
  readonly channel: number
  readonly capability = GRAPHICS_CAPABILITY
  readonly version = GRAPHICS_VERSION

  private readonly scene = new Scene()
  private readonly host: GraphicsServiceHost
  private readonly scheduler: GraphicsScheduler
  private readonly queue: GraphicsInput[] = []
  private connection: ServiceConnection | null = null
  private parked: Parked | null = null
  private touched = false
  private pointer = { x: 0, y: 0 }
  private readonly controls = new Map<string, ControlDescriptor>()
  private batching = false

  constructor(options: GraphicsServiceOptions) {
    this.host = options.host
    this.channel = options.channel ?? CHANNEL_GRAPHICS
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  /** Latest immutable scene snapshot for the renderer. */
  snapshot(): SceneSnapshot {
    return { ...this.scene.snapshot(), ...(this.controls.size ? { controls: [...this.controls.values()] } : {}) }
  }

  get connected(): boolean {
    return this.connection !== null && !this.connection.signal.aborted
  }

  // ---- HostService lifecycle -------------------------------------------------

  onConnect(connection: ServiceConnection): void {
    this.connection = connection
    this.reset()
    this.host.onConnected?.()
  }

  /** Clear a previous run's scene without opening a device or using graphics. */
  reset(): void {
    this.clearParked()
    this.queue.length = 0
    this.touched = false
    this.pointer = { x: 0, y: 0 }
    this.controls.clear()
    this.batching = false
    this.scene.setCanvas(DEFAULT_CANVAS)
    this.host.requestRender()
  }

  onDisconnect(): void {
    this.clearParked()
    this.queue.length = 0
    this.connection = null
    this.host.onDisconnected?.()
    // The scene is intentionally retained so the final image stays visible.
    this.host.requestRender()
  }

  // ---- Input (from the panel) ------------------------------------------------

  /** Called by the renderer when the user interacts with a focused canvas. */
  submitInput(event: GraphicsInput): void {
    if (!this.connected) return
    if ('x' in event) this.pointer = { x: event.x, y: event.y }
    if ('controlId' in event) {
      const control = this.controls.get(event.controlId)
      if (!control) return
      try { this.controls.set(control.id, parseControl({ ...control, value: event.value })) } catch { return }
      this.host.requestRender()
    }
    // A parked event waiter takes the event directly (bypasses the queue).
    if (this.parked?.kind === 'event') {
      const parked = this.parked
      this.clearParked()
      this.respond(parked.id, true, { event })
      return
    }
    if (isCoalescible(event)) {
      const tail = this.queue[this.queue.length - 1]
      if (tail && tail.kind === event.kind) {
        this.queue[this.queue.length - 1] = event
        return
      }
    }
    this.queue.push(event)
    if (this.queue.length > LIMITS.MAX_EVENT_QUEUE) this.queue.shift()
  }

  // ---- Frame handling --------------------------------------------------------

  handleFrame(payload: Uint8Array, request?: ServiceRequest): void {
    if (request?.signal.aborted) return
    let message: Record<string, unknown>
    try {
      message = decodeJsonObject(payload)
    } catch (error) {
      // A malformed graphics frame is dropped (the client validates before
      // sending, so this only happens for a misbehaving guest).
      console.warn('[python-graphics] dropping malformed frame:', (error as Error).message)
      return
    }
    // Requests and commands are disjoint op sets. `id` means the request id on a
    // request and the object id on a command, so dispatch by op, never by the
    // presence of an `id` field.
    if (typeof message.op === 'string' && REQUEST_OPS.has(message.op)) {
      this.handleRequest(message, request)
    } else if (typeof message.id === 'number') {
      this.respond(message.id, false, undefined, ERROR_CODES.BAD_REQUEST, 'Unknown graphics request')
    } else {
      this.handleCommand(message)
    }
  }

  private handleRequest(message: Record<string, unknown>, request?: ServiceRequest): void {
    const id = message.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 0xffffffff) {
      return // unaddressable; drop
    }
    const op = message.op
    if (this.parked) {
      this.respond(id, false, undefined, ERROR_CODES.BAD_REQUEST, 'a request is already outstanding')
      return
    }
    try {
      switch (op) {
        case 'init':
          if (message.version !== GRAPHICS_VERSION) throw new ProtocolError(ERROR_CODES.UNSUPPORTED, 'Unsupported graphics service version')
          this.respond(id, true, { service: GRAPHICS_CAPABILITY, version: GRAPHICS_VERSION, limits: publicLimits() })
          return
        case 'flush':
          this.batching = false
          this.host.requestRender()
          this.respond(id, true, {})
          return
        case 'pointer':
          this.respond(id, true, this.pointer)
          return
        case 'drain_events': {
          const kinds = message.kinds
          if (!Array.isArray(kinds) || kinds.some(v => typeof v !== 'string') || kinds.length > 12) throw new ProtocolError('bad_request', 'invalid event kinds')
          const events = this.queue.filter(event => kinds.includes(event.kind))
          for (let i = this.queue.length - 1; i >= 0; i--) if (kinds.includes(this.queue[i]!.kind)) this.queue.splice(i, 1)
          this.respond(id, true, { events })
          return
        }
        case 'object':
          this.respond(id, true, this.require(message.target))
          return
        case 'control_value': {
          const control = this.controls.get(validateTargetId(message.target))
          if (!control) throw new ProtocolError('unknown_object', 'unknown control')
          this.respond(id, true, { value: control.value })
          return
        }
        case 'overlapping': {
          const x1 = finiteNumber(message.x1, 'x1'), y1 = finiteNumber(message.y1, 'y1')
          const x2 = finiteNumber(message.x2, 'x2'), y2 = finiteNumber(message.y2, 'y2')
          const ids = this.scene.snapshot().objects.filter(object => {
            if (!object.visible) return false
            const box = this.measure(object)
            return box.x <= Math.max(x1, x2) && box.x + box.w >= Math.min(x1, x2) && box.y <= Math.max(y1, y2) && box.y + box.h >= Math.min(y1, y2)
          }).map(object => object.id)
          this.respond(id, true, { ids })
          return
        }
        case 'metrics': {
          const c = this.scene.canvas
          this.respond(id, true, { w: c.w, h: c.h })
          return
        }
        case 'bounds': {
          const object = this.scene.getById(validateTargetId(message.target))
          if (!object) throw new ProtocolError(ERROR_CODES.UNKNOWN_OBJECT, `unknown object: ${String(message.target)}`)
          this.respond(id, true, this.measure(object))
          return
        }
        case 'pause': {
          const ms = clamp(finiteNumber(message.ms, 'ms'), 0, LIMITS.MAX_PAUSE_MS)
          // Assign `parked` before scheduling so a synchronous scheduler cannot
          // fire the callback before the slot is set and wedge the gate.
          const parked: Parked = { kind: 'pause', id, timer: null }
          this.parked = parked
          this.bindRequest(parked, request)
          parked.timer = this.scheduler.setTimeout(() => {
            if (this.parked !== parked) return
            this.clearParked()
            this.respond(id, true, {})
          }, ms)
          return
        }
        case 'wait_event': {
          const queued = this.queue.shift()
          if (queued) {
            this.respond(id, true, { event: queued })
            return
          }
          // Validate BEFORE parking: a throw here must not leave the
          // single-outstanding gate occupied for the rest of the run.
          const timeout = message.timeout_ms === undefined
            ? undefined
            : clamp(finiteNumber(message.timeout_ms, 'timeout_ms'), 0, LIMITS.MAX_PAUSE_MS)
          const parked: Parked = { kind: 'event', id, timer: null }
          this.parked = parked
          this.bindRequest(parked, request)
          if (timeout !== undefined) {
            parked.timer = this.scheduler.setTimeout(() => {
              if (this.parked !== parked) return
              this.clearParked()
              this.respond(id, true, { event: null })
            }, timeout)
          }
          return
        }
        case 'poll_event':
          this.respond(id, true, { event: this.queue.shift() ?? null })
          return
        default:
          this.respond(id, false, undefined, ERROR_CODES.BAD_REQUEST, `unknown op: ${String(op)}`)
      }
    } catch (error) {
      const code = error instanceof ProtocolError ? error.code : ERROR_CODES.INTERNAL
      const text = error instanceof Error ? error.message : String(error)
      this.respond(id, false, undefined, code, text)
    }
  }

  private handleCommand(message: Record<string, unknown>): void {
    // Commands are fire-and-forget: a validation failure is dropped (the client
    // mirrors this validation and raises in Python before sending).
    try {
      switch (message.op) {
        case 'frame_begin': this.batching = true; return
        case 'frame_end': this.batching = false; this.host.requestRender(); return
        case 'control_add': {
          const control = parseControl(message.control)
          if (this.controls.size >= MAX_CONTROLS || this.controls.has(control.id)) throw new ProtocolError('limit_exceeded', 'control limit or duplicate id')
          this.controls.set(control.id, control)
          break
        }
        case 'control_set': {
          const control = this.controls.get(validateTargetId(message.id))
          if (!control) throw new ProtocolError('unknown_object', 'unknown control')
          this.controls.set(control.id, parseControl({ ...control, value: message.value }))
          break
        }
        case 'control_delete': this.controls.delete(validateTargetId(message.id)); break

        case 'canvas':
          this.scene.setCanvas(this.buildCanvas(message))
          break
        case 'add': {
          if (this.scene.size >= LIMITS.MAX_OBJECTS) throw new ProtocolError(ERROR_CODES.TOO_MANY_OBJECTS, 'MAX_OBJECTS reached')
          const object = buildObject(message)
          if (object.kind === 'image') this.host.validateImage?.(object.resourceId, object.resourceVersion)
          if (this.scene.has(object.id)) throw new ProtocolError(ERROR_CODES.DUPLICATE_OBJECT, `duplicate id: ${object.id}`)
          this.scene.add(object)
          break
        }
        case 'move': {
          const object = this.require(message.id)
          this.scene.replace(translateObject(object, finiteNumber(message.dx, 'dx'), finiteNumber(message.dy, 'dy')))
          break
        }
        case 'moveto': {
          const object = this.require(message.id)
          const [rx, ry] = objectReferencePoint(object)
          this.scene.replace(translateObject(object, finiteNumber(message.x, 'x') - rx, finiteNumber(message.y, 'y') - ry))
          break
        }
        case 'update': {
          const object = applyUpdate(this.require(message.id), message.props)
          if (object.kind === 'image') this.host.validateImage?.(object.resourceId, object.resourceVersion)
          this.scene.replace(object)
          break
        }
        case 'delete':
          this.scene.remove(this.require(message.id).id)
          break
        case 'visible': {
          const object = this.require(message.id)
          this.scene.replace({ ...object, visible: Boolean(message.on) })
          break
        }
        case 'order':
          this.scene.reorder(this.require(message.id).id, validateOrderMode(message.mode))
          break
        case 'clear':
          this.scene.clearObjects()
          break
        default:
          console.warn('[python-graphics] unknown command op:', String(message.op))
          return
      }
      this.host.onSceneMutation?.()
      if (!this.touched) {
        this.touched = true
        this.host.onFirstCommand?.()
      }
      if (!this.batching) this.host.requestRender()
    } catch (error) {
      console.warn('[python-graphics] dropping invalid command:', (error as Error).message)
    }
  }

  private require(id: unknown): SceneObject {
    const object = this.scene.getById(validateTargetId(id))
    if (!object) throw new ProtocolError(ERROR_CODES.UNKNOWN_OBJECT, `unknown object: ${String(id)}`)
    return object
  }

  private buildCanvas(message: Record<string, unknown>): CanvasState {
    const w = clamp(finiteNumber(message.w, 'w'), 1, LIMITS.MAX_CANVAS_DIM)
    const h = clamp(finiteNumber(message.h, 'h'), 1, LIMITS.MAX_CANVAS_DIM)
    const background = message.background === undefined ? 'white' : validateColor(message.background, 'background')
    let title = ''
    if (message.title !== undefined) {
      if (typeof message.title !== 'string') throw new ProtocolError(ERROR_CODES.BAD_REQUEST, 'title must be a string')
      title = message.title.slice(0, 256)
    }
    return { w, h, background, title }
  }

  private measure(object: SceneObject): Bounds {
    if (object.kind === 'text') {
      const measured = this.host.measureText?.(object)
      return measured ?? estimateTextBounds(object)
    }
    return geometricBounds(object) ?? { x: 0, y: 0, w: 0, h: 0 }
  }

  private respond(id: number, ok: boolean, result?: unknown, code?: string, message?: string): void {
    if (!this.connection || this.connection.signal.aborted) return
    const body = ok ? { id, ok, result } : { id, ok, error: { code, message } }
    this.connection.send(encodeJson(body))
  }

  private bindRequest(parked: Parked, request?: ServiceRequest): void {
    if (!request) return
    const abort = () => { if (this.parked === parked) this.clearParked() }
    request.signal.addEventListener('abort', abort, { once: true })
    parked.detachAbort = () => request.signal.removeEventListener('abort', abort)
  }

  private clearParked(): void {
    this.parked?.detachAbort?.()
    if (this.parked?.timer != null) this.scheduler.clearTimeout(this.parked.timer)
    this.parked = null
  }
}

function publicLimits() {
  return {
    maxObjects: LIMITS.MAX_OBJECTS,
    maxPoints: LIMITS.MAX_POINTS,
    maxScenePoints: LIMITS.MAX_SCENE_POINTS,
    maxSceneTextLen: LIMITS.MAX_SCENE_TEXT_LEN,
    maxTextLen: LIMITS.MAX_TEXT_LEN,
    maxCanvasDim: LIMITS.MAX_CANVAS_DIM,
    maxPauseMs: LIMITS.MAX_PAUSE_MS,
  }
}

function validateTargetId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ProtocolError(ERROR_CODES.BAD_REQUEST, 'object id must be a string of 1..128 characters')
  }
  return value
}

function validateOrderMode(value: unknown): OrderMode {
  if (value === 'front' || value === 'back' || value === 'forward' || value === 'backward') return value
  throw new ProtocolError(ERROR_CODES.BAD_REQUEST, `invalid order mode: ${String(value)}`)
}

/** DOM-free fallback estimate used when the renderer is not mounted. */
function estimateTextBounds(object: SceneObject & { kind: 'text' }): Bounds {
  const w = object.text.length * object.fontSize * 0.6
  return anchoredBox(object.anchor, object.x, object.y, w, object.fontSize)
}
