import type { Bounds } from './geometry'
import type { SceneObject } from './scene'

/** Text measurement is injected by a renderer; the headless core needs no DOM. */
export type TextObject = SceneObject & { kind: 'text' }
export type MeasureFn = (object: TextObject) => Bounds | null
