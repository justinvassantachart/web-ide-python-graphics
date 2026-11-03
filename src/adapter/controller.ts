/**
 * Glue between a {@link GraphicsService} and the React panel. Owns the scene
 * snapshot and connection observables, coalesces repaints to one microtask per
 * batch of commands, and delegates text measurement to the live renderer when
 * one is mounted. One controller exists per Web IDE mount (per runtime session).
 */

import { Observable } from '../observable'
import type { SceneSnapshot } from '../model/scene'
import {
  GraphicsService,
  type GraphicsScheduler,
  type GraphicsServiceHost,
} from '../service/graphics-service'
import type { GraphicsInput } from '../service/events'
import type { HostService } from '../mux/service'
import type { MeasureFn } from '../renderer/SvgCanvas'

export class GraphicsController {
  readonly service: GraphicsService
  readonly snapshot: Observable<SceneSnapshot>
  readonly connected = new Observable<boolean>(false)

  private measurer: MeasureFn | null = null
  private renderScheduled = false
  private dirty = false
  private disposed = false

  constructor(scheduler?: GraphicsScheduler) {
    const host: GraphicsServiceHost = {
      requestRender: () => this.scheduleRender(),
      measureText: (object) => this.measurer?.(object) ?? null,
      onConnected: () => this.connected.set(true),
      onDisconnected: () => this.connected.set(false),
    }
    this.service = new GraphicsService({ host, scheduler })
    this.snapshot = new Observable<SceneSnapshot>(this.service.snapshot())
  }

  /** The HostService to register with a {@link DeviceMultiplexer}. */
  get hostService(): HostService {
    return this.service
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
    this.snapshot.set(this.service.snapshot())
  }

  dispose(): void {
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
