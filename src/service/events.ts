/**
 * Input events the panel submits to the graphics service. Coordinates are
 * already mapped to logical canvas units by the renderer (via the inverse SVG
 * CTM). These are only ever handed to the guest inside a `poll_event`/
 * `wait_event` response (pull, never push).
 */

export type PointerEventKind =
  | 'mousedown'
  | 'mouseup'
  | 'mouseclick'
  | 'mousemove'
  | 'mousedrag'

export type KeyEventKind = 'keydown' | 'keyup' | 'keypress'

export interface PointerInput {
  readonly kind: PointerEventKind
  readonly x: number
  readonly y: number
  /** 0 = left, 1 = middle, 2 = right. */
  readonly button: number
}

export interface KeyInput {
  readonly kind: KeyEventKind
  /** Normalized key name (e.g. 'a', 'ArrowLeft', 'Enter', ' '). */
  readonly key: string
  /** Printable character for keypress, else undefined. */
  readonly text?: string
}

export interface ControlInput {
  readonly kind: 'controlchange' | 'controlsubmit' | 'controlclick'
  readonly controlId: string
  readonly value: string | number | boolean
}
export type GraphicsInput = PointerInput | KeyInput | ControlInput

/** Consecutive move/drag events coalesce (only the latest matters). */
export function isCoalescible(event: GraphicsInput): boolean {
  return event.kind === 'mousemove' || event.kind === 'mousedrag'
}
