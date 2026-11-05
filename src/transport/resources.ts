import TRANSPORT_PY from '../python/web_ide_transport/__init__.py?raw'

export const TRANSPORT_PY_PATH = '/web_ide_transport/__init__.py'
/** Execution-only source map; does not import or initialize graphics. */
export const TRANSPORT_PYTHON_SOURCES: Readonly<Record<string, string>> = {
  [TRANSPORT_PY_PATH]: TRANSPORT_PY,
}
