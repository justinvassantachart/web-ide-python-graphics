/**
 * The execution-only resource that ships the Python helper into every run. The
 * helper is a package directory (`/graphics/__init__.py` + `/graphics/turtle.py`)
 * so it never flattens onto a student's `/workspace/graphics.py` (which would be
 * a hard collision that blocks all runs); CPython imports this package in
 * preference to a shadowed user module. The sources are inlined at build time.
 */

import CORE_PY from '../python/graphics/__init__.py?raw'
import TURTLE_PY from '../python/graphics/turtle.py?raw'
import type { IDEWorkspaceResourceContribution } from 'web-ide'

export const GRAPHICS_RESOURCE_ID = 'web-ide.python-graphics.resource'
/** Guest path of the core module: `import graphics`. */
export const GRAPHICS_PY_PATH = '/graphics/__init__.py'
/** Guest path of the turtle-style adapter: `from graphics.turtle import Turtle`. */
export const GRAPHICS_TURTLE_PY_PATH = '/graphics/turtle.py'

/** The raw Python sources, exported for hosts that compose resources manually. */
export const GRAPHICS_PYTHON_SOURCES: Readonly<Record<string, string>> = {
  [GRAPHICS_PY_PATH]: CORE_PY,
  [GRAPHICS_TURTLE_PY_PATH]: TURTLE_PY,
}

export function createGraphicsResource(): IDEWorkspaceResourceContribution {
  return {
    id: GRAPHICS_RESOURCE_ID,
    scope: 'execution-only',
    files: { ...GRAPHICS_PYTHON_SOURCES },
  }
}
