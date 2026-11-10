import { describe, expect, it, vi } from 'vitest'
import { GraphicsController } from './controller'
import { encodeJson } from '../protocol/codec'

describe('GraphicsController reset', () => {
  it('clears the prior run without opening a new graphics connection', () => {
    const controller = new GraphicsController()
    controller.service.onConnect({ signal: new AbortController().signal, send() {} })
    controller.service.handleFrame(encodeJson({ op: 'add', id: 'g1', shape: 'rect', x: 0, y: 0, w: 1, h: 1 }))
    controller.flush()
    expect(controller.status.value.drew).toBe(true)
    controller.service.onDisconnect()
    controller.reset()
    expect(controller.snapshot.value.objects).toHaveLength(0)
    expect(controller.status.value).toEqual({ phase: 'never-run', drew: false })
    expect(controller.service.connected).toBe(false)
    controller.dispose()
  })
})

describe('graphics/image resource ordering', () => {
  it('pins pixels immediately and publishes a removal before releasing its last scene lease', async () => {
    const order: string[] = []
    const controller = new GraphicsController(undefined, { onEvent: event => {
      if (event.kind === 'resource-release') order.push('release')
    } })
    const images = controller.images.service
    const transfer = await images.dispatch({ op: 'rgba.begin', width: 1, height: 1 }) as { transferId: string }
    await images.dispatch({ op: 'transfer.write', transferId: transfer.transferId, offset: 0, base64: 'AQID/w==' })
    const resource = await images.dispatch({ op: 'rgba.commit', transferId: transfer.transferId }) as { resourceId: string; version: number }
    controller.service.onConnect({ signal: new AbortController().signal, send() {} })
    controller.service.handleFrame(encodeJson({ op: 'add', id: 'image1', shape: 'image', x: 0, y: 0, w: 1, h: 1, resourceId: resource.resourceId, resourceVersion: resource.version }))
    await images.dispatch({ op: 'resource.release', ...resource })
    expect(images.getResource(resource).data).toEqual(new Uint8Array([1, 2, 3, 255]))
    controller.flush()
    controller.snapshot.subscribe(() => order.push('scene'))
    controller.service.handleFrame(encodeJson({ op: 'delete', id: 'image1' }))
    expect(order).toEqual([])
    controller.flush()
    expect(order).toEqual(['scene', 'release'])
    expect(images.snapshot().resources).toEqual([])
    controller.dispose()
  })
})

it('pins every scene mutation inside a frame batch and rolls back failed multi-retains', async () => {
  const controller = new GraphicsController()
  const images = controller.images.service
  async function upload(resourceId?: string) {
    const transfer = await images.dispatch({ op: 'rgba.begin', width: 1, height: 1, ...(resourceId ? { resourceId } : {}) }) as { transferId: string }
    await images.dispatch({ op: 'transfer.write', transferId: transfer.transferId, offset: 0, base64: 'AQID/w==' })
    return await images.dispatch({ op: 'rgba.commit', transferId: transfer.transferId }) as { resourceId: string; version: number }
  }
  controller.service.onConnect({ signal: new AbortController().signal, send() {} })
  controller.service.handleFrame(encodeJson({ op: 'frame_begin' }))
  const old = await upload()
  const add = (id: string, ref: typeof old) => controller.service.handleFrame(encodeJson({ op: 'add', id, shape: 'image', x: 0, y: 0, w: 1, h: 1, resourceId: ref.resourceId, resourceVersion: ref.version }))
  add('old', old)
  const next = await upload(old.resourceId)
  await images.dispatch({ op: 'resource.release', ...old })
  add('next', next)
  await images.dispatch({ op: 'resource.release', ...next })
  controller.service.handleFrame(encodeJson({ op: 'frame_end' }))
  controller.flush()
  expect(controller.snapshot.value.objects).toHaveLength(2)
  expect(images.getResource(old).data).toHaveLength(4)
  expect(images.getResource(next).data).toHaveLength(4)
  const newRef = await upload()
  const retained = vi.spyOn(images, 'retainResource')
  const released = vi.spyOn(images, 'releaseResource')
  const object = controller.snapshot.value.objects[0]!
  if (object.kind !== 'image') throw new Error('fixture expected image')
  expect(() => controller.images.retainScene({ ...controller.snapshot.value, objects: [
    { ...object, id: 'new', resourceId: newRef.resourceId, resourceVersion: newRef.version },
    { ...object, id: 'invalid', resourceId: 'missing', resourceVersion: 1 },
  ] })).toThrow()
  expect(retained).toHaveBeenCalledWith({ resourceId: newRef.resourceId, version: newRef.version })
  expect(released).toHaveBeenCalledWith({ resourceId: newRef.resourceId, version: newRef.version })
  await images.dispatch({ op: 'resource.release', ...newRef })
  expect(() => images.getResource(newRef)).toThrow()
  controller.dispose()
})
