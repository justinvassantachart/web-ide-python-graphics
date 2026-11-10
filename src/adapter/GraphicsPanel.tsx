/**
 * Web IDE panel that renders the per-session graphics scene. It receives only
 * public {@link IDEPanelServices}; it resolves its controller reactively from
 * the per-session registry (populated by `plugin.activate`), so it works no
 * matter whether it mounts before or after activation and survives tab
 * switches. It owns no device registration itself.
 *
 * Display states (from the controller's {@link GraphicsStatus}):
 * - never run → hint only (no canvas);
 * - running / ended and the program issued ≥1 graphics command → the canvas;
 * - ended without drawing → a "finished without drawing" hint (no canvas).
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { IDEPanelServices } from 'web-ide'
import { DEFAULT_CANVAS, type SceneSnapshot } from '../model/scene'
import { ImageGallery } from '../renderer/ImageGallery'
import type { ImageServiceSnapshot } from 'web-ide/assets'
import { SvgCanvas, type MeasureFn } from '../renderer/SvgCanvas'
import type { GraphicsInput } from '../service/events'
import type { GraphicsController, GraphicsStatus } from './controller'
import { controllerRegistry } from './registry'

const EMPTY_SNAPSHOT: SceneSnapshot = { canvas: DEFAULT_CANVAS, objects: [], version: 0 }
const EMPTY_IMAGES: ImageServiceSnapshot = { resources: [], presentations: [], outputs: [] }
const NEVER_RUN: GraphicsStatus = { phase: 'never-run', drew: false }

// Follow the host workbench theme (light/dark) through Web IDE's public CSS
// variables, with neutral fallbacks for use outside a Web IDE mount.
const wrapperStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  background: 'var(--color-chrome, #1e1e1e)',
}

const hintStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  textAlign: 'center',
  color: 'var(--color-muted-foreground, #c8c8c8)',
  font: '13px/1.5 system-ui, sans-serif',
  maxWidth: 420,
  margin: '0 auto',
  pointerEvents: 'none',
}

const codeStyle: CSSProperties = { font: '12px ui-monospace, SFMono-Regular, Menlo, monospace' }

function useController(session: object): GraphicsController | undefined {
  return useSyncExternalStore(
    useCallback((onChange) => controllerRegistry.subscribe(session, onChange), [session]),
    useCallback(() => controllerRegistry.get(session), [session]),
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={hintStyle} role="note">{children}</div>
}

export function GraphicsPanel({ runtime }: IDEPanelServices) {
  const controller = useController(runtime)

  const snapshot = useSyncExternalStore(
    useCallback((cb) => (controller ? controller.snapshot.subscribe(() => cb()) : () => {}), [controller]),
    useCallback(() => controller?.snapshot.value ?? EMPTY_SNAPSHOT, [controller]),
  )
  const status = useSyncExternalStore(
    useCallback((cb) => (controller ? controller.status.subscribe(() => cb()) : () => {}), [controller]),
    useCallback(() => controller?.status.value ?? NEVER_RUN, [controller]),
  )

  const images = useSyncExternalStore(
    useCallback(cb => controller ? controller.images.snapshot.subscribe(() => cb()) : () => {}, [controller]),
    useCallback(() => controller?.images.snapshot.value ?? EMPTY_IMAGES, [controller]),
  )
  // Stable callbacks so SvgCanvas does not rebind its measurer every frame.
  const onInput = useCallback((event: GraphicsInput) => controller?.submitInput(event), [controller])
  const bindMeasure = useCallback((measure: MeasureFn | null) => controller?.setMeasurer(measure), [controller])

  if (!controller) {
    const supported = typeof runtime.registerHostDevice === 'function'
    return (
      <div style={wrapperStyle}>
        <Hint>
          {supported
            ? 'Graphics panel is starting…'
            : 'This runtime does not provide a graphics device.'}
        </Hint>
      </div>
    )
  }

  if (!status.drew && !images.presentations.length && !images.outputs.length) {
    return (
      <div style={wrapperStyle}>
        <Hint>
          {status.phase === 'ended' ? (
            <span>The program finished without drawing anything.</span>
          ) : status.phase === 'running' ? (
            <span>Waiting for the program to draw…</span>
          ) : (
            <span>
              Run a Python program that uses the graphics library to draw here:
              <br />
              <span style={codeStyle}>from graphics import Canvas</span>
            </span>
          )}
        </Hint>
      </div>
    )
  }

  return (
    <div style={{ ...wrapperStyle, overflow: 'auto' }}>
      {status.drew && <div style={{ minHeight: 240 }}><SvgCanvas snapshot={snapshot} onInput={onInput} bindMeasure={bindMeasure} readImageResource={controller.images.readResource} /></div>}
      <ImageGallery snapshot={images} readResource={controller.images.readResource} downloadPresentation={id => controller.images.service.downloadPresentation(id)} getOutput={id => controller.images.service.getOutput(id)} />
    </div>
  )
}
