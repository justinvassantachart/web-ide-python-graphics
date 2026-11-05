import { createRoot } from 'react-dom/client'
import {
  WebIDE,
  WebIDEHostProvider,
  initWebIDETheme,
  type IDEPlugin,
  type WebIDEConfiguration,
  type WebIDEHost,
} from 'web-ide'
import { pythonRuntimePlugin } from 'web-ide/runtimes'
import { coreWorkbenchPlugin } from 'web-ide/plugins'
import { createPythonGraphicsPlugin } from '@web-ide/python-graphics'
import { createJsonService } from '@web-ide/python-graphics/transport'
import 'web-ide/styles.css'
import { PROGRAMS, type ProgramKey } from './programs'

// QA controls (see docs/VERIFICATION.md): program=<key>, host=plain,
// service=multi, instances=2, panel=<15..57>, theme=dark|light (index.html).
const params = new URLSearchParams(window.location.search)
const program = (params.get('program') ?? 'shapes') as ProgramKey
if (params.has('worker')) {
  const worker = new Worker(new URL('./graphics-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = () => worker.terminate()
  worker.postMessage('check')
}
const withGraphics = params.get('host') !== 'plain'
const withMulti = params.get('service') === 'multi'
const twoInstances = params.get('instances') === '2'
const panelPercent = Number(params.get('panel') ?? 55)

function buildConfig(): WebIDEConfiguration {
  const plugins: IDEPlugin[] = [pythonRuntimePlugin, coreWorkbenchPlugin]
  if (withGraphics) {
    plugins.push(createPythonGraphicsPlugin(
      withMulti ? { createAdditionalServices: () => [createJsonService({ channel: 2, capability: 'echo', version: 1, handleRequest: message => ({ echo: message.value }) })] } : {},
    ))
  }
  return {
    runtimeProvider: 'web-ide.runtime.python',
    plugins,
    ...(withGraphics
      ? { initialLayout: { selectedPanelId: 'web-ide.python-graphics', panelColumnPercent: panelPercent } }
      : {}),
  }
}

function host(id: string, source: string): WebIDEHost {
  return { workspace: { id, localCache: 'memory', initialFiles: { '/workspace/main.py': source } } }
}

function Instance({ id, source }: { id: string; source: string }) {
  return (
    <WebIDEHostProvider host={host(id, source)}>
      <div style={{ width: '100%', height: '100%' }}>
        <WebIDE configuration={buildConfig()} />
      </div>
    </WebIDEHostProvider>
  )
}

initWebIDETheme()
const root = createRoot(document.getElementById('root')!)
if (twoInstances) {
  root.render(
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '2px solid #444' }}>
        <Instance id="qa-a" source={PROGRAMS.shapes} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Instance id="qa-b" source={PROGRAMS.bounce} />
      </div>
    </div>,
  )
} else {
  root.render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <Instance id={`qa-${program}`} source={PROGRAMS[program] ?? PROGRAMS.shapes} />
    </div>,
  )
}
