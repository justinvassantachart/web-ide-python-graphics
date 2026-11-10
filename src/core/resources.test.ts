import { expect, it } from 'vitest'
import { getPythonGraphicsAvailability, getAvailablePythonGraphicsSources, detectDesktopImageHelper } from './resources'
it('disables only the colliding adapter while preserving shared services', () => {
  expect(getPythonGraphicsAvailability(['/workspace/simpleimage.py'])).toEqual({ transport: true, graphics: true, images: true, simpleimage: false, drawcanvas: true })
  const files = getAvailablePythonGraphicsSources(['/simpleimage.py'])
  expect(files['/simpleimage.py']).toBeUndefined()
  expect(files['/graphics/image.py']).toContain('class Image:')
  expect(files['/drawcanvas.py']).toContain('class DrawCanvas:')
})
it('disables dependencies for graphics or transport collisions', () => {
  expect(getPythonGraphicsAvailability(['graphics/helper.py']).images).toBe(false)
  expect(getPythonGraphicsAvailability(['web_ide_transport.py']).drawcanvas).toBe(false)
})
it('detects desktop dependencies without treating comments as imports', () => {
  expect(detectDesktopImageHelper('from PIL import Image')).toBe(true)
  expect(detectDesktopImageHelper('import tkinter as tk')).toBe(true)
  expect(detectDesktopImageHelper('# import PIL\nfrom graphics import Image')).toBe(false)
})

it('matches only case-sensitive imports at the guest module root', () => {
  expect(getPythonGraphicsAvailability(['lib/graphics.py', 'notes/simpleimage.py', 'Graphics.py', 'SimpleImage.py'])).toEqual({ transport: true, graphics: true, images: true, simpleimage: true, drawcanvas: true })
  expect(getPythonGraphicsAvailability(['graphics/__init__.py']).graphics).toBe(false)
})
