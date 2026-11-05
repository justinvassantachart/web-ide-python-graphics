import { describe, expect, it, vi } from 'vitest'
import { createPythonGraphicsPlugin } from './plugin'
import { controllerRegistry } from './registry'
import type { HostByteDevice } from '../mux/service'
import { encodeFrame } from '../protocol/frames'
import { encodeJson } from '../protocol/codec'

function harness() {
  let opener: ((device: HostByteDevice) => void | (() => void)) | undefined
  let runCleanup: (() => void) | undefined
  let abort: AbortController | undefined
  let listener: ((chunk: Uint8Array) => void) | null = null
  const registrationDispose = vi.fn(() => { opener = undefined })
  const stop = vi.fn(() => { abort?.abort(); runCleanup?.() })
  const session = {
    registerHostDevice(callback: typeof opener) { opener = callback; return { dispose: registrationDispose } },
    stop,
  }
  return {
    session, stop, registrationDispose,
    start() {
      abort = new AbortController()
      runCleanup = opener!({
        signal: abort.signal,
        onData(callback) { listener = callback; return () => { listener = null } },
        async write() {},
      }) ?? undefined
      listener?.(encodeFrame(0, encodeJson({ t: 'hello', mux: 1 })))
      listener?.(encodeFrame(1, encodeJson({ op: 'wait_event', id: 1 })))
    },
    get listening() { return listener !== null },
    get aborted() { return abort?.signal.aborted },
  }
}

describe('default plugin lifecycle', () => {
  it('closes a parked guest request and stops the active runtime on deactivation', () => {
    const h = harness()
    const plugin = createPythonGraphicsPlugin()
    const deactivate = plugin.activate!({ runtime: h.session } as never)
    h.start()
    expect(h.listening).toBe(true)
    expect(controllerRegistry.get(h.session)?.service.connected).toBe(true)
    if (typeof deactivate !== 'function') throw new Error('expected synchronous cleanup')
    deactivate()
    expect(h.stop).toHaveBeenCalledOnce()
    expect(h.registrationDispose).toHaveBeenCalledOnce()
    expect(h.listening).toBe(false)
    expect(h.aborted).toBe(true)
    expect(controllerRegistry.get(h.session)).toBeUndefined()
  })

  it('reactivates the same plugin with a fresh controller and does not stop idle runs', () => {
    const h = harness()
    const plugin = createPythonGraphicsPlugin()
    const first = plugin.activate!({ runtime: h.session } as never)
    const before = controllerRegistry.get(h.session)
    if (typeof first !== 'function') throw new Error('expected cleanup')
    first()
    expect(h.stop).not.toHaveBeenCalled()
    const second = plugin.activate!({ runtime: h.session } as never)
    expect(controllerRegistry.get(h.session)).not.toBe(before)
    h.start()
    expect(h.listening).toBe(true)
    if (typeof second !== 'function') throw new Error('expected cleanup')
    second()
    expect(h.stop).toHaveBeenCalledOnce()
  })
})
