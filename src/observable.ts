/**
 * Minimal synchronous observable. Used for the controller→panel bridge and
 * scene-snapshot notifications. No external dependency; listeners are called
 * synchronously and a thrown listener never breaks the others.
 */
export class Observable<T> {
  private readonly listeners = new Set<(value: T) => void>()
  private current: T

  constructor(initial: T) {
    this.current = initial
  }

  get value(): T {
    return this.current
  }

  set(value: T): void {
    this.current = value
    this.emit()
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.current)
      } catch (error) {
        // A failing subscriber must not break sibling subscribers or the caller.
        console.error('[python-graphics] observable listener failed', error)
      }
    }
  }
}
