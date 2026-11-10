// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RasterImage, type ImageResourceReader } from './RasterImage'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('raster buffer ownership', () => {
  it('budgets readback plus canvas, uses a view instead of another copy, and does not reread on geometry changes', async () => {
    const data = new Uint8Array([1, 2, 3, 255])
    let resident = 0, peak = 0
    const reads: number[] = []
    const reader: ImageResourceReader = () => { reads.push(resident); return { width: 1, height: 1, data } }
    reader.byteLength = () => 4
    reader.reserveBytes = bytes => { resident += bytes; peak = Math.max(peak, resident); return () => { resident -= bytes } }
    let imageDataBuffer: ArrayBufferLike | undefined
    vi.stubGlobal('ImageData', class { constructor(view: Uint8ClampedArray) { imageDataBuffer = view.buffer } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData() {} } as unknown as CanvasRenderingContext2D)
    const element = document.createElement('div')
    const root = createRoot(element)
    await act(async () => root.render(createElement(RasterImage, { resourceId: 'r', version: 1, readResource: reader })))
    expect(reads).toEqual([4])
    expect(peak).toBe(8)
    expect(resident).toBe(4)
    expect(imageDataBuffer).toBe(data.buffer)
    await act(async () => root.render(createElement(RasterImage, { resourceId: 'r', version: 1, readResource: reader, label: 'moved' })))
    expect(reads).toHaveLength(1)
    await act(async () => root.unmount())
    expect(resident).toBe(0)
  })
  it('shows a bounded display failure without reading or crashing the surrounding view', async () => {
    const read = vi.fn(() => ({ width: 1, height: 1, data: new Uint8Array(4) }))
    const reader: ImageResourceReader = read
    reader.byteLength = () => 4
    reader.reserveBytes = () => { throw new Error('Image display budget exceeded') }
    const element = document.createElement('div')
    const root = createRoot(element)
    await act(async () => root.render(createElement(RasterImage, { resourceId: 'r', version: 1, readResource: reader })))
    expect(read).not.toHaveBeenCalled()
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('Image display budget exceeded')
    expect(element.querySelector('[role="alert"]')?.hasAttribute('hidden')).toBe(false)
    await act(async () => root.unmount())
  })
})
