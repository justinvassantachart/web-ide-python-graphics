/**
 * The execution-only resource that ships the Python helper into every run. The
 * helper is a package directory (`/graphics/__init__.py` + `/graphics/turtle.py`)
 * so it never flattens onto a student's `/workspace/graphics.py` (which would be
 * a hard collision that blocks all runs); CPython imports this package in
 * preference to a shadowed user module. The sources are inlined at build time.
 */

import type { IDEWorkspaceResourceContribution } from 'web-ide'
import { GRAPHICS_PYTHON_SOURCES, GRAPHICS_RESOURCE_ID } from '../core/resources'
export {
  GRAPHICS_PYTHON_SOURCES, GRAPHICS_RESOURCE_ID, GRAPHICS_PY_PATH, GRAPHICS_TURTLE_PY_PATH,
  GRAPHICS_IMAGE_PY_PATH, SIMPLEIMAGE_PY_PATH, DRAWCANVAS_PY_PATH, getPythonGraphicsAvailability, getAvailablePythonGraphicsSources, detectDesktopImageHelper,
} from '../core/resources'

export function createGraphicsResource(): IDEWorkspaceResourceContribution {
  return {
    id: GRAPHICS_RESOURCE_ID,
    scope: 'execution-only',
    files: { ...GRAPHICS_PYTHON_SOURCES },
  }
}
