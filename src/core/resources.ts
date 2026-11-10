/** Pure execution-only source map for main-thread and worker hosts. */
import IMAGE_PY from '../python/graphics/image.py?raw'
import SIMPLEIMAGE_PY from '../python/simpleimage.py?raw'
import DRAWCANVAS_PY from '../python/drawcanvas.py?raw'
import CORE_PY from '../python/graphics/__init__.py?raw'
import TURTLE_PY from '../python/graphics/turtle.py?raw'
import { TRANSPORT_PYTHON_SOURCES } from '../transport/resources'

export const GRAPHICS_IMAGE_PY_PATH = '/graphics/image.py'
export const SIMPLEIMAGE_PY_PATH = '/simpleimage.py'
export const DRAWCANVAS_PY_PATH = '/drawcanvas.py'

export const GRAPHICS_RESOURCE_ID = 'web-ide.python-graphics.resource'
/** Guest path of the core module: `import graphics`. */
export const GRAPHICS_PY_PATH = '/graphics/__init__.py'
/** Guest path of the turtle-style adapter: `from graphics.turtle import Turtle`. */
export const GRAPHICS_TURTLE_PY_PATH = '/graphics/turtle.py'

/** The raw Python sources, exported for hosts that compose resources manually. */
export const GRAPHICS_PYTHON_SOURCES: Readonly<Record<string, string>> = {
  ...TRANSPORT_PYTHON_SOURCES,
  [GRAPHICS_PY_PATH]: CORE_PY,
  [GRAPHICS_IMAGE_PY_PATH]: IMAGE_PY,
  [SIMPLEIMAGE_PY_PATH]: SIMPLEIMAGE_PY,
  [DRAWCANVAS_PY_PATH]: DRAWCANVAS_PY,
  [GRAPHICS_TURTLE_PY_PATH]: TURTLE_PY,
}


/** Dependency-aware execution availability. Student files are never replaced. */
export function getPythonGraphicsAvailability(paths: readonly string[]) {
  const normalized = paths.map(path => path.replace(/^\/(?:workspace\/)?/, ''))
  const collision = (name: string) => normalized.some(path => path === `${name}.py` || path === name || path.startsWith(`${name}/`))
  const transport = !collision('web_ide_transport')
  const graphics = transport && !collision('graphics')
  return { transport, graphics, images: graphics, simpleimage: graphics && !collision('simpleimage'), drawcanvas: graphics && !collision('drawcanvas') }
}

export function getAvailablePythonGraphicsSources(paths: readonly string[]): Readonly<Record<string, string>> {
  const available = getPythonGraphicsAvailability(paths)
  const sources: Record<string, string> = {}
  for (const [path, source] of Object.entries(GRAPHICS_PYTHON_SOURCES)) {
    if (path.startsWith('/web_ide_transport/') && available.transport || path.startsWith('/graphics/') && available.graphics || path === SIMPLEIMAGE_PY_PATH && available.simpleimage || path === DRAWCANVAS_PY_PATH && available.drawcanvas) sources[path] = source
  }
  return sources
}

export function detectDesktopImageHelper(source: string): boolean {
  return /^\s*(?:from\s+(?:PIL|tkinter)(?:\.|\s)|import\s+(?:PIL|tkinter)(?:\s|,|$))/m.test(source)
}
