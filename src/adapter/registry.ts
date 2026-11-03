/**
 * Subscribable per-session controller registry: the bridge from
 * `plugin.activate` (which creates the controller and registers the host
 * device) to the panel (which only receives public panel services). Keyed by
 * the `RuntimeSession` object identity — the same object both sides hold — so
 * concurrent Web IDE mounts stay isolated and entries are garbage-collected
 * with their session. Deletion is identity-guarded so a React StrictMode
 * throwaway activation cannot evict the live controller.
 */

import type { GraphicsController } from './controller'

// `object` keys avoid a hard dependency on the RuntimeSession type here.
const controllers = new WeakMap<object, GraphicsController>()
const listeners = new WeakMap<object, Set<() => void>>()

function notify(session: object): void {
  const set = listeners.get(session)
  if (!set) return
  for (const listener of [...set]) {
    try {
      listener()
    } catch (error) {
      console.error('[python-graphics] registry listener failed', error)
    }
  }
}

export const controllerRegistry = {
  get(session: object): GraphicsController | undefined {
    return controllers.get(session)
  },

  set(session: object, controller: GraphicsController): void {
    controllers.set(session, controller)
    notify(session)
  },

  /** Removes the entry only if it still points at `controller`. */
  delete(session: object, controller: GraphicsController): void {
    if (controllers.get(session) !== controller) return
    controllers.delete(session)
    notify(session)
  },

  subscribe(session: object, listener: () => void): () => void {
    let set = listeners.get(session)
    if (!set) {
      set = new Set()
      listeners.set(session, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
    }
  },
}
