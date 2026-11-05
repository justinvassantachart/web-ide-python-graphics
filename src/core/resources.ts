/** Pure execution-only source map for main-thread and worker hosts. */
import CORE_PY from '../python/graphics/__init__.py?raw'
import TURTLE_PY from '../python/graphics/turtle.py?raw'
import { TRANSPORT_PYTHON_SOURCES } from '../transport/resources'

export const GRAPHICS_RESOURCE_ID = 'web-ide.python-graphics.resource'
/** Guest path of the core module: `import graphics`. */
export const GRAPHICS_PY_PATH = '/graphics/__init__.py'
/** Guest path of the turtle-style adapter: `from graphics.turtle import Turtle`. */
export const GRAPHICS_TURTLE_PY_PATH = '/graphics/turtle.py'

/** The raw Python sources, exported for hosts that compose resources manually. */
export const GRAPHICS_PYTHON_SOURCES: Readonly<Record<string, string>> = {
  ...TRANSPORT_PYTHON_SOURCES,
  [GRAPHICS_PY_PATH]: CORE_PY,
  [GRAPHICS_TURTLE_PY_PATH]: TURTLE_PY,
}

