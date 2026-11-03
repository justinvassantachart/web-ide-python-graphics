/**
 * Web IDE panel that renders the per-session graphics scene. It receives only
 * public {@link IDEPanelServices}; it resolves its controller reactively from
 * the per-session registry (populated by `plugin.activate`), so it works no
 * matter whether it mounts before or after activation and survives tab
 * switches. It owns no device registration itself.
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { IDEPanelServices } from 'web-ide'
import { DEFAULT_CANVAS, type SceneSnapshot } from '../model/scene'
import { SvgCanvas, type MeasureFn } from '../renderer/SvgCanvas'
import type { GraphicsInput } from '../service/events'
import type { GraphicsController } from './controller'
import { controllerRegistry } from './registry'

const EMPTY_SNAPSHOT: SceneSnapshot = { canvas: DEFAULT_CANVAS, objects: [], version: 0 }

const wrapperStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  background: '#1e1e1e',
}

const hintStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  textAlign: 'center',
  color: '#c8c8c8',
  font: '13px/1.5 system-ui, sans-serif',
  pointerEvents: 'none',
}

function useController(session: object): GraphicsController | undefined {
  return useSyncExternalStore(
    useCallback((onChange) => controllerRegistry.subscribe(session, onChange), [session]),
    useCallback(() => controllerRegistry.get(session), [session]),
  )
}

export function GraphicsPanel({ runtime }: IDEPanelServices) {
  const controller = useController(runtime)

  const snapshot = useSyncExternalStore(
    useCallback((cb) => (controller ? controller.snapshot.subscribe(() => cb()) : () => {}), [controller]),
    useCallback(() => controller?.snapshot.value ?? EMPTY_SNAPSHOT, [controller]),
  )
  const connected = useSyncExternalStore(
    useCallback((cb) => (controller ? controller.connected.subscribe(() => cb()) : () => {}), [controller]),
    useCallback(() => controller?.connected.value ?? false, [controller]),
  )

  // Stable callbacks so SvgCanvas does not rebind its measurer every frame.
  const onInput = useCallback((event: GraphicsInput) => controller?.submitInput(event), [controller])
  const bindMeasure = useCallback((measure: MeasureFn | null) => controller?.setMeasurer(measure), [controller])

  if (!controller) {
    const supported = typeof runtime.registerHostDevice === 'function'
    return (
      <div style={wrapperStyle}>
        <div style={hintStyle}>
          {supported
            ? 'Graphics panel is starting…'
            : 'This runtime does not provide a graphics device.'}
        </div>
      </div>
    )
  }

  const showHint = !connected && snapshot.objects.length === 0
  return (
    <div style={wrapperStyle}>
      <SvgCanvas snapshot={snapshot} onInput={onInput} bindMeasure={bindMeasure} />
      {showHint && (
        <div style={hintStyle}>
          Run a Python program that uses the <code>&nbsp;graphics&nbsp;</code> library
          (<code>from graphics import Canvas</code>) to draw here.
        </div>
      )}
    </div>
  )
}
