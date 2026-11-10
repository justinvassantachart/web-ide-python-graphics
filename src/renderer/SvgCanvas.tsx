/**
 * SVG renderer for a {@link SceneSnapshot}. Projects the retained model to SVG
 * nodes (document order = z-order), maps pointer events to logical canvas units
 * via the inverse CTM, and captures keyboard input only while the canvas is
 * focused (never document-wide). Text is set as element textContent, never HTML.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { GraphicsControls } from './GraphicsControls'
import { RasterImage, type ImageResourceReader } from './RasterImage'
import { anchoredBox, type TextAnchor } from '../model/geometry'
import type { SceneObject, SceneSnapshot } from '../model/scene'
import type { GraphicsInput } from '../service/events'
import type { MeasureFn } from '../model/measure'
export type { MeasureFn, TextObject } from '../model/measure'

export interface SvgCanvasProps {
  snapshot: SceneSnapshot
  readImageResource?: ImageResourceReader
  onInput?: (event: GraphicsInput) => void
  /** Registers/unregisters the live text measurer with the owner. */
  bindMeasure?: (measure: MeasureFn | null) => void
}

const CLICK_THRESHOLD = 4 // logical units of movement that still counts as a click
const PREVENT_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', 'Home', 'End',
])

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
}

const svgStyle: CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  touchAction: 'none',
  outline: 'none',
  borderRadius: 2,
}

// Keyboard input is focus-scoped, so keyboard users need to see when the canvas
// has focus. Match the host's focus border (web-ide exposes `--color-ring`);
// pointer-initiated focus does not show the ring, like `:focus-visible`.
const focusRingStyle: CSSProperties = {
  ...svgStyle,
  boxShadow: '0 0 0 2px var(--color-ring, #0078d4)',
}

function focusIsVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true // older engines: always show the ring rather than never
  }
}

function textAnchorFor(anchor: TextAnchor): 'start' | 'middle' | 'end' {
  if (anchor === 'nw' || anchor === 'w' || anchor === 'sw') return 'start'
  if (anchor === 'ne' || anchor === 'e' || anchor === 'se') return 'end'
  return 'middle'
}

type Baseline = 'text-before-edge' | 'central' | 'text-after-edge'

function baselineFor(anchor: TextAnchor): Baseline {
  if (anchor === 'nw' || anchor === 'n' || anchor === 'ne') return 'text-before-edge'
  if (anchor === 'sw' || anchor === 's' || anchor === 'se') return 'text-after-edge'
  return 'central'
}

function renderObject(object: SceneObject, readImageResource?: ImageResourceReader) {
  if (!object.visible) return null
  const { style } = object
  const common = {
    fill: style.fill,
    stroke: style.outline,
    strokeWidth: style.width,
    opacity: style.opacity,
  }
  switch (object.kind) {
    case 'image':
      return <foreignObject key={object.id} x={object.x} y={object.y} width={object.w} height={object.h} opacity={style.opacity} pointerEvents="none">
        <RasterImage resourceId={object.resourceId} version={object.resourceVersion} readResource={readImageResource} sampling={object.sampling} />
      </foreignObject>
    case 'line':
      return (
        <line key={object.id} x1={object.x1} y1={object.y1} x2={object.x2} y2={object.y2}
          stroke={style.outline} strokeWidth={style.width} opacity={style.opacity} />
      )
    case 'rect':
      return <rect key={object.id} x={object.x} y={object.y} width={object.w} height={object.h} {...common} />
    case 'oval':
      return (
        <ellipse key={object.id} cx={object.x + object.w / 2} cy={object.y + object.h / 2}
          rx={object.w / 2} ry={object.h / 2} {...common} />
      )
    case 'polyline':
      return <polyline key={object.id} points={pointsToString(object.points)} {...common} fill={style.fill} />
    case 'polygon':
      return <polygon key={object.id} points={pointsToString(object.points)} {...common} />
    case 'text':
      return (
        <text key={object.id} x={object.x} y={object.y} fill={style.fill}
          fontSize={object.fontSize} fontFamily={object.fontFamily}
          textAnchor={textAnchorFor(object.anchor)} dominantBaseline={baselineFor(object.anchor)}
          opacity={style.opacity} style={{ userSelect: 'none', whiteSpace: 'pre' }}>
          {object.text}
        </text>
      )
  }
}

function pointsToString(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}

export function SvgCanvas({ snapshot, onInput, bindMeasure, readImageResource }: SvgCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const measureTextRef = useRef<SVGTextElement>(null)
  const pointer = useRef({ down: false, button: 0, x0: 0, y0: 0, moved: false })
  const [focusRing, setFocusRing] = useState(false)
  const { canvas, objects } = snapshot

  const toLogical = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current
    if (!svg || typeof svg.getScreenCTM !== 'function') return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return [point.x, point.y]
  }, [])

  // Register a live text measurer with the owner while mounted.
  useLayoutEffect(() => {
    if (!bindMeasure) return
    const measure: MeasureFn = (object) => {
      const node = measureTextRef.current
      if (!node || typeof node.getBBox !== 'function') return null
      node.textContent = object.text
      node.setAttribute('font-size', String(object.fontSize))
      node.setAttribute('font-family', object.fontFamily)
      try {
        const box = node.getBBox()
        return anchoredBox(object.anchor, object.x, object.y, box.width, box.height)
      } catch {
        return null
      }
    }
    bindMeasure(measure)
    return () => bindMeasure(null)
  }, [bindMeasure])

  const emitPointer = useCallback((
    kind: GraphicsInput['kind'], clientX: number, clientY: number, button: number,
  ) => {
    if (!onInput) return
    const logical = toLogical(clientX, clientY)
    if (!logical) return
    onInput({ kind: kind as 'mousemove', x: logical[0], y: logical[1], button })
  }, [onInput, toLogical])

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current?.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointer.current = { down: true, button: event.button, x0: event.clientX, y0: event.clientY, moved: false }
    emitPointer('mousedown', event.clientX, event.clientY, event.button)
  }, [emitPointer])

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const state = pointer.current
    if (state.down) {
      if (Math.abs(event.clientX - state.x0) + Math.abs(event.clientY - state.y0) > CLICK_THRESHOLD) {
        state.moved = true
      }
      emitPointer('mousedrag', event.clientX, event.clientY, state.button)
    } else {
      emitPointer('mousemove', event.clientX, event.clientY, 0)
    }
  }, [emitPointer])

  const onPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const state = pointer.current
    emitPointer('mouseup', event.clientX, event.clientY, event.button)
    if (state.down && !state.moved && event.button === state.button) {
      emitPointer('mouseclick', event.clientX, event.clientY, event.button)
    }
    pointer.current = { ...state, down: false, moved: false }
  }, [emitPointer])

  const onKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!onInput) return
    if (PREVENT_KEYS.has(event.key)) event.preventDefault()
    onInput({ kind: 'keydown', key: event.key, text: event.key.length === 1 ? event.key : undefined })
    if (event.key.length === 1) onInput({ kind: 'keypress', key: event.key, text: event.key })
  }, [onInput])

  const onKeyUp = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    onInput?.({ kind: 'keyup', key: event.key })
  }, [onInput])

  return (
    <div style={{ ...containerStyle, flexDirection: 'column' }} data-python-graphics-canvas="">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${canvas.w} ${canvas.h}`}
        width={canvas.w}
        height={canvas.h}
        preserveAspectRatio="xMidYMid meet"
        style={focusRing ? focusRingStyle : svgStyle}
        tabIndex={0}
        role="img"
        aria-label={canvas.title ? `Graphics canvas: ${canvas.title}` : 'Graphics canvas'}
        onFocus={(event) => setFocusRing(focusIsVisible(event.currentTarget))}
        onBlur={() => setFocusRing(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <rect x={0} y={0} width={canvas.w} height={canvas.h} fill={canvas.background} />
        {objects.map(object => renderObject(object, readImageResource))}
        {/* Off-screen probe for text measurement; never visible. */}
        <text ref={measureTextRef} x={-99999} y={-99999} visibility="hidden" aria-hidden="true" />
      </svg>
      {snapshot.controls?.length ? <GraphicsControls controls={snapshot.controls} onInput={onInput} /> : null}
    </div>
  )
}
