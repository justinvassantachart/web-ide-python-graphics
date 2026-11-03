// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

// Mark this as a React act() environment so state flushes deterministically.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SvgCanvas } from './SvgCanvas'
import type { SceneSnapshot } from '../model/scene'
import type { GraphicsInput } from '../service/events'

const style = { fill: 'red', outline: 'navy', width: 2, opacity: 1 }

function snapshot(objects: SceneSnapshot['objects']): SceneSnapshot {
  return { canvas: { w: 200, h: 100, background: 'white', title: 'T' }, objects, version: 1 }
}

describe('SvgCanvas rendering', () => {
  it('maps each shape and style to the right SVG element', () => {
    const markup = renderToStaticMarkup(createElement(SvgCanvas, {
      snapshot: snapshot([
        { id: 'r', kind: 'rect', visible: true, style, x: 1, y: 2, w: 10, h: 20 },
        { id: 'o', kind: 'oval', visible: true, style, x: 0, y: 0, w: 40, h: 20 },
        { id: 'hidden', kind: 'rect', visible: false, style, x: 0, y: 0, w: 5, h: 5 },
      ]),
    }))
    expect(markup).toContain('<rect x="1" y="2" width="10" height="20"')
    expect(markup).toContain('fill="red"')
    expect(markup).toContain('stroke="navy"')
    expect(markup).toContain('<ellipse cx="20" cy="10" rx="20" ry="10"')
    // A hidden object is not rendered.
    expect(markup).not.toContain('width="5"')
    // Background uses the canvas color and an accessible label is present.
    expect(markup).toContain('fill="white"')
    expect(markup).toContain('aria-label="Graphics canvas: T"')
  })

  it('renders text as escaped content with anchor-derived alignment', () => {
    const markup = renderToStaticMarkup(createElement(SvgCanvas, {
      snapshot: snapshot([
        { id: 't', kind: 'text', visible: true, style: { ...style, fill: 'black' }, x: 5, y: 6, text: '<b>&x</b>', anchor: 'center', fontSize: 14, fontFamily: 'serif' },
      ]),
    }))
    expect(markup).toContain('text-anchor="middle"')
    expect(markup).toContain('dominant-baseline="central"')
    expect(markup).toContain('&lt;b&gt;&amp;x&lt;/b&gt;') // escaped, never raw HTML
    expect(markup).not.toContain('<b>&x</b>')
  })

  it('preserves z-order (document order = array order)', () => {
    const markup = renderToStaticMarkup(createElement(SvgCanvas, {
      snapshot: snapshot([
        { id: 'back', kind: 'rect', visible: true, style: { ...style, fill: 'gold' }, x: 0, y: 0, w: 1, h: 1 },
        { id: 'front', kind: 'rect', visible: true, style: { ...style, fill: 'lime' }, x: 0, y: 0, w: 1, h: 1 },
      ]),
    }))
    expect(markup.indexOf('gold')).toBeLessThan(markup.indexOf('lime'))
  })
})

describe('SvgCanvas input (scaled coordinates, focus-scoped)', () => {
  let container: HTMLDivElement
  afterEach(() => { container?.remove() })

  async function mount(onInput: (e: GraphicsInput) => void) {
    container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(SvgCanvas, { snapshot: snapshot([]), onInput }))
    })
    const svg = container.querySelector('svg') as SVGSVGElement
    // Polyfill the CTM so client pixels map to logical units: screen = 2*logical + offset.
    ;(globalThis as unknown as { DOMPoint: unknown }).DOMPoint = class {
      x: number; y: number
      constructor(x = 0, y = 0) { this.x = x; this.y = y }
      matrixTransform(m: { a: number; d: number; e: number; f: number }) { return { x: this.x * m.a + m.e, y: this.y * m.d + m.f } }
    }
    svg.getScreenCTM = () => ({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20, inverse: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: -5, f: -10 }) }) as unknown as DOMMatrix
    return svg
  }

  it('maps pointer client coordinates back to logical units', async () => {
    const events: GraphicsInput[] = []
    const svg = await mount((e) => events.push(e))
    await act(async () => { svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 210, clientY: 420, button: 0, bubbles: true })) })
    // (210-10)/2 = 100, (420-20)/2 = 200
    expect(events.at(-1)).toMatchObject({ kind: 'mousedown', x: 100, y: 200, button: 0 })
  })

  it('synthesizes a click when the pointer does not move, and a drag when it does', async () => {
    const events: GraphicsInput[] = []
    const svg = await mount((e) => events.push(e))
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 60, button: 0, bubbles: true }))
      svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 60, button: 0, bubbles: true }))
    })
    expect(events.map((e) => e.kind)).toEqual(['mousedown', 'mouseup', 'mouseclick'])

    events.length = 0
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 60, button: 0, bubbles: true }))
      svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 120, button: 0, bubbles: true }))
      svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 120, clientY: 120, button: 0, bubbles: true }))
    })
    expect(events.map((e) => e.kind)).toEqual(['mousedown', 'mousedrag', 'mouseup'])
  })

  it('emits keypress only for printable keys', async () => {
    const events: GraphicsInput[] = []
    const svg = await mount((e) => events.push(e))
    await act(async () => { svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) })
    expect(events.map((e) => e.kind)).toEqual(['keydown', 'keypress'])
    events.length = 0
    await act(async () => { svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(events.map((e) => e.kind)).toEqual(['keydown'])
  })
})
