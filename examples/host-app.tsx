/**
 * Reference host composition. A real app installs `web-ide` and
 * `@web-ide/python-graphics` (e.g. from packed tarballs or a `file:` reference),
 * configures Vite for the runtime (wasm, node shims, COOP/COEP headers), and
 * renders <WebIDE> with the graphics plugin.
 */
import { createRoot } from 'react-dom/client'
import {
  WebIDE,
  WebIDEHostProvider,
  initWebIDETheme,
  type IDEPlugin,
  type WebIDEConfiguration,
} from 'web-ide'
import { pythonRuntimePlugin } from 'web-ide/runtimes'
import { coreWorkbenchPlugin } from 'web-ide/plugins'
import {
  createPythonGraphicsPlugin,
  type HostService,
  type ServiceConnection,
} from '@web-ide/python-graphics'
import { decodeJsonObject, encodeJson } from '@web-ide/python-graphics'
import 'web-ide/styles.css'

// --- Optional: a mock second service sharing the single byte device. --------
// It lives on channel 2, is response-only, and is created per mount. This shows
// a host routing graphics and an independent service over one registered
// device without the companion hard-coding any application route.
class ClockService implements HostService {
  readonly channel = 2
  readonly capability = 'clock'
  readonly version = 1
  private connection: ServiceConnection | null = null
  onConnect(connection: ServiceConnection) { this.connection = connection }
  handleFrame(payload: Uint8Array) {
    const message = decodeJsonObject(payload)
    if (typeof message.id === 'number') {
      this.connection?.send(encodeJson({ id: message.id, ok: true, result: { now: Date.now() } }))
    }
  }
  onDisconnect() { this.connection = null }
}

const graphicsPlugin: IDEPlugin = createPythonGraphicsPlugin({
  // Omit `createAdditionalServices` for the default graphics-only composition.
  createAdditionalServices: () => [new ClockService()],
})

const configuration: WebIDEConfiguration = {
  runtimeProvider: 'web-ide.runtime.python',
  plugins: [pythonRuntimePlugin, coreWorkbenchPlugin, graphicsPlugin],
  initialLayout: { selectedPanelId: 'web-ide.python-graphics' },
}

initWebIDETheme()
createRoot(document.getElementById('root')!).render(
  <WebIDEHostProvider
    host={{
      workspace: {
        id: 'python-graphics-demo-v1',
        initialFiles: {
          '/workspace/main.py': [
            'from graphics import Canvas',
            '',
            'c = Canvas(400, 300, title="Hello")',
            'c.create_rectangle(40, 40, 160, 130, fill="skyblue", outline="navy", width=3)',
            'c.create_oval(200, 60, 320, 180, fill="gold")',
            'c.create_text(200, 20, "click me", color="black", anchor="center")',
            'while c.is_open():',
            '    event = c.get_event()',
            '    if event and event.type == "mouseclick":',
            '        c.create_line(0, 0, event.x, event.y, color="crimson", width=2)',
          ].join('\n'),
        },
      },
    }}
  >
    <div style={{ width: '100vw', height: '100vh' }}>
      <WebIDE configuration={configuration} />
    </div>
  </WebIDEHostProvider>,
)
