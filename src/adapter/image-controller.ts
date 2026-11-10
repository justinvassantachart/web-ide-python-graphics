/** Thin Python byte-channel adapter; image policy/codecs remain in web-ide/assets. */
import { createImageService, ImageServiceError, type ImageService, type ImageServiceEvent, type ImageServiceOptions, type ImageServiceSnapshot, type ImageResourceRef } from 'web-ide/assets'
import { Observable } from '../observable'
import { createJsonService, ServiceError } from '../transport/json-service'
import type { HostService } from '../mux/service'
import type { SceneSnapshot } from '../model/scene'

export const IMAGE_CHANNEL = 3
export const IMAGE_CAPABILITY = 'images'
export const IMAGE_VERSION = 1

export class ImageController {
  readonly service: ImageService
  readonly hostService: HostService
  readonly snapshot = new Observable<ImageServiceSnapshot>({ resources: [], presentations: [], outputs: [] })
  private sceneRefs = new Map<string, Pick<ImageResourceRef, 'resourceId' | 'version'>>()

  constructor(options: ImageServiceOptions = {}) {
    const service = createImageService({ ...options, onEvent: (event: ImageServiceEvent) => {
      options.onEvent?.(event)
      if (this.service) this.snapshot.set(this.service.snapshot())
    } })
    this.service = service
    this.readResource.reserveBytes = bytes => service.reserveExternalBytes(bytes)
    this.readResource.byteLength = ref => service.snapshot().resources.find(resource => resource.resourceId === ref.resourceId && resource.version === ref.version)?.byteLength
    const adapter = createJsonService({ channel: IMAGE_CHANNEL, capability: IMAGE_CAPABILITY, version: IMAGE_VERSION,
      handleRequest: async (request, { signal }) => {
        try { return await service.dispatch(request, signal) }
        catch (error) {
          if (error instanceof ImageServiceError) throw new ServiceError(error.code, error.message)
          throw error
        }
      },
    })
    this.hostService = {
      ...adapter,
      onConnect: () => this.reset(),
      onDisconnect: () => { service.disconnect(); this.snapshot.set(service.snapshot()) },
    }
  }

  /** Pin immutable image revisions before old scene references are released. */
  retainScene(snapshot: SceneSnapshot, releasePrevious = true): void {
    const next = new Map<string, Pick<ImageResourceRef, 'resourceId' | 'version'>>()
    for (const object of snapshot.objects) if (object.kind === 'image') {
      const key = `${object.resourceId}:${object.resourceVersion}`
      next.set(key, { resourceId: object.resourceId, version: object.resourceVersion })
    }
    const acquired: Pick<ImageResourceRef, 'resourceId' | 'version'>[] = []
    try {
      for (const [key, ref] of next) if (!this.sceneRefs.has(key)) {
        this.service.retainResource(ref)
        acquired.push(ref)
      }
    } catch (error) {
      for (const ref of acquired) this.service.releaseResource(ref)
      throw error
    }
    if (releasePrevious) {
      for (const [key, ref] of this.sceneRefs) if (!next.has(key)) this.service.releaseResource(ref)
      this.sceneRefs = next
    } else {
      for (const [key, ref] of next) this.sceneRefs.set(key, ref)
    }
  }

  readonly readResource: ((ref: Pick<ImageResourceRef, 'resourceId' | 'version'>) => ReturnType<ImageService['getResource']> | undefined) & { reserveBytes?: (bytes: number) => () => void; byteLength?: (ref: Pick<ImageResourceRef, 'resourceId' | 'version'>) => number | undefined } = (ref: Pick<ImageResourceRef, 'resourceId' | 'version'>) => {
    try { return this.service.getResource(ref) } catch { return undefined }
  }

  reset(): void {
    this.sceneRefs.clear()
    this.service.reset()
    this.snapshot.set(this.service.snapshot())
  }

  dispose(): void {
    this.sceneRefs.clear()
    this.service.dispose()
  }
}
