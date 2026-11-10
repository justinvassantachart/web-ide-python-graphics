import { useLayoutEffect, useRef } from 'react'
import type { ImagePixels, ImageResourceRef } from 'web-ide/assets'

export type ImageResourceReader = ((ref: Pick<ImageResourceRef, 'resourceId' | 'version'>) => ImagePixels | undefined) & { reserveBytes?: (byteLength: number) => () => void; byteLength?: (ref: Pick<ImageResourceRef, 'resourceId' | 'version'>) => number | undefined }

/** Paint only when a resource revision changes, never on sprite movement. */
export function RasterImage({ resourceId, version, readResource, label, sampling = 'smooth' }: {
  resourceId: string; version: number; readResource?: ImageResourceReader; label?: string; sampling?: 'nearest' | 'smooth'
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const error = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const node = canvas.current
    if (!node || !readResource) return
    const ref = { resourceId, version }
    const byteLength = readResource.byteLength?.(ref)
    let releaseCopy: (() => void) | undefined
    let releaseBacking: (() => void) | undefined
    try {
      // Reserve the readback before making its owned copy. A clamped view shares
      // that buffer with ImageData, avoiding a second full raster allocation.
      if (byteLength !== undefined) releaseCopy = readResource.reserveBytes?.(byteLength)
      const pixels = readResource(ref)
      if (!pixels) throw new Error('Image pixels are unavailable for display. The image may still be downloaded.')
      releaseCopy ??= readResource.reserveBytes?.(pixels.data.byteLength)
      releaseBacking = readResource.reserveBytes?.(pixels.width * pixels.height * 4)
      node.width = pixels.width
      node.height = pixels.height
      if (!(pixels.data.buffer instanceof ArrayBuffer)) throw new Error('Image pixels must own an ordinary byte buffer')
      const context = node.getContext('2d')
      if (context) context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), pixels.width, pixels.height), 0, 0)
      node.style.display = 'block'
      if (error.current) { error.current.textContent = ''; error.current.hidden = true }
    } catch (cause) {
      node.width = 0; node.height = 0
      releaseBacking?.()
      releaseBacking = undefined
      node.style.display = 'none'
      if (error.current) { error.current.textContent = cause instanceof Error ? cause.message : 'Image could not be displayed'; error.current.hidden = false }
    } finally { releaseCopy?.() }
    return () => { node.width = 0; node.height = 0; releaseBacking?.() }
  }, [resourceId, version, readResource])
  return <><span ref={error} role="alert" hidden /><canvas ref={canvas} role="img" aria-label={label || 'Image'} style={{ width: '100%', height: '100%', display: 'block', imageRendering: sampling === 'nearest' ? 'pixelated' : 'auto' }} /></>
}
