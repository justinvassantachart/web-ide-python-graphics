import { describe, expect, it } from 'vitest'
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
