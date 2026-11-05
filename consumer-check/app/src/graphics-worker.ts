import {
  GraphicsController, GRAPHICS_PYTHON_SOURCES, parseGraphicsInput, parseSceneSnapshot,
  type GraphicsInput, type GraphicsStatus, type SceneSnapshot,
} from '@web-ide/python-graphics/core'

// This consumer is compiled as an actual module worker, never through the UI
// entry. The build fails if any retained module brings React/editor/DOM code.
self.onmessage = () => {
  const controller = new GraphicsController()
  controller.reset()
  const scene: SceneSnapshot = parseSceneSnapshot(controller.snapshot.value)
  const input: GraphicsInput = parseGraphicsInput({ kind: 'keydown', key: 'a' })
  const status: GraphicsStatus = controller.status.value
  self.postMessage({ scene, input, status, paths: Object.keys(GRAPHICS_PYTHON_SOURCES) })
  controller.dispose()
}
