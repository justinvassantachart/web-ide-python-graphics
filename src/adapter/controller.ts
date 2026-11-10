/**
 * Glue between a {@link GraphicsService} and the React panel. Owns the scene
 * snapshot and connection observables, coalesces repaints to one microtask per
 * batch of commands, and delegates text measurement to the live renderer when
 * one is mounted. One controller exists per Web IDE mount (per runtime session).
 */

import { ImageController } from './image-controller'
import type { ImageServiceOptions } from 'web-ide/assets'
import { Observable } from '../observable'
import type { SceneSnapshot } from '../model/scene'
import {
  GraphicsService,
  type GraphicsScheduler,
  type GraphicsServiceHost,
} from '../service/graphics-service'
import type { GraphicsInput } from '../service/events'
import type { HostService } from '../mux/service'
import type { MeasureFn } from '../model/measure'

/**
 * What the panel should show. `phase` tracks the run's device; `drew` is true
 * once the program applied at least one graphics command this run, so a
 * program that never touches graphics does not produce a blank canvas.
 */
export interface GraphicsStatus {
  readonly phase: 'never-run' | 'running' | 'ended'
  readonly drew: boolean
}

export class GraphicsController {
  readonly service: GraphicsService
  readonly images: ImageController
  readonly snapshot: Observable<SceneSnapshot>
  readonly status = new Observable<GraphicsStatus>({ phase: 'never-run', drew: false })

  private measurer: MeasureFn | null = null
  private renderScheduled = false
  private dirty = false
  private disposed = false

  constructor(scheduler?: GraphicsScheduler, imageOptions?: ImageServiceOptions) {
    this.images = new ImageController(imageOptions)
    const host: GraphicsServiceHost = {
      requestRender: () => this.scheduleRender(),
      onSceneMutation: () => this.images.retainScene(this.service.snapshot(), false),
      validateImage: (resourceId, version) => {
        if (!this.images.service.snapshot().resources.some(ref => ref.resourceId === resourceId && ref.version === version)) throw new Error('stale image resource')
      },
      measureText: (object) => this.measurer?.(object) ?? null,
      onConnected: () => this.status.set({ phase: 'running', drew: false }),
      onFirstCommand: () => this.status.set({ phase: 'running', drew: true }),
      onDisconnected: () => this.status.set({ phase: 'ended', drew: this.status.value.drew }),
    }
    this.service = new GraphicsService({ host, scheduler })
    this.snapshot = new Observable<SceneSnapshot>(this.service.snapshot())
  }

  /** The HostService to register with a {@link DeviceMultiplexer}. */
  get hostService(): HostService {
    return this.service
  }

  get hostServices(): HostService[] {
    return [this.hostService, this.images.hostService]
  }

  submitInput(event: GraphicsInput): void {
    this.service.submitInput(event)
  }

  /** Called by the mounted renderer to provide/withdraw text measurement. */
  setMeasurer(measure: MeasureFn | null): void {
    this.measurer = measure
  }

  /** Forces a pending repaint to flush now (used in tests). */
  flush(): void {
    this.renderScheduled = false
    if (!this.dirty) return
    this.dirty = false
    const snapshot = this.service.snapshot()
    this.images.retainScene(snapshot, false)
    this.snapshot.set(snapshot)
    this.images.retainScene(snapshot)
  }

  /** Clear stale output between runs, including runs with no graphics service. */
  reset(): void {
    this.images.reset()
    this.service.reset()
    this.status.set({ phase: 'never-run', drew: false })
    this.flush()
  }

  dispose(): void {
    this.images.dispose()
    this.disposed = true
    this.measurer = null
  }

  private scheduleRender(): void {
    this.dirty = true
    if (this.renderScheduled || this.disposed) return
    this.renderScheduled = true
    queueMicrotask(() => {
      if (this.disposed) return
      this.flush()
    })
  }
}
