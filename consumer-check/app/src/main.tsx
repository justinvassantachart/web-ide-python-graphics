import { imageSha256, type WorkspaceAssetRefV1 } from 'web-ide/assets'
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
declare global { interface Window { imageFixtureEvents: { type: string; payload: unknown; at: number }[] } }
window.imageFixtureEvents = []
const params = new URLSearchParams(window.location.search)
const program = (params.get('program') ?? 'shapes') as ProgramKey
function benchmarkSource(source: string): string {
  if (program !== 'sand_benchmark') return source
  const width = params.get('width') === '100' ? 100 : 50
  const seconds = params.get('duration') === '60' ? 60 : 0
  return source.replace('WIDTH, HEIGHT, SCALE, FRAMES = 50, 50, 10, 180', `WIDTH, HEIGHT, SCALE, FRAMES = ${width}, 50, 10, 180`).replace('SECONDS = 0', `SECONDS = ${seconds}`)
}
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

// Browser-native fixture generation exercises genuine encoded PNG/JPEG bytes.
const fixtureImages: Record<string, Uint8Array> = {}
const fixtureRefs: WorkspaceAssetRefV1[] = []
if (program === 'image_inputs' || program === 'ghost_benchmark') {
  const specifications = program === 'ghost_benchmark'
    ? Array.from({ length: 9 }, (_, index) => ({ path: `/workspace/ghost-inputs/${index}.png`, width: 1000, height: 750, mime: 'image/png' as const, color: `rgb(${100+index},80,60)` }))
    : [{ path: '/workspace/images/foreground.png', width: 8, height: 6, mime: 'image/png' as const, color: 'blue' }, { path: '/workspace/images/background.jpg', width: 8, height: 6, mime: 'image/jpeg' as const, color: 'red' }]
  for (const specification of specifications) {
    const canvas = document.createElement('canvas')
    canvas.width = specification.width; canvas.height = specification.height
    const context = canvas.getContext('2d')!
    context.fillStyle = specification.color; context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), specification.mime))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    fixtureImages[specification.path] = bytes
    fixtureRefs.push({ path: specification.path, blobId: specification.path, sha256: await imageSha256(bytes), byteLength: bytes.length, mediaType: specification.mime })
  }
}

function host(id: string, source: string): WebIDEHost {
  return { events: { includeRuntime: true, emit: (type, payload) => window.imageFixtureEvents.push({ type, payload, at: performance.now() }) }, workspace: { id, localCache: 'memory', ...(fixtureRefs.length ? { documentPersistence: { save: () => undefined }, initialDocument: { schemaVersion: 2 as const, files: [{ path: '/workspace/main.py', content: source }], assets: fixtureRefs }, assets: { read: async (asset: WorkspaceAssetRefV1) => fixtureImages[asset.path]!.slice(), stage: async () => { throw new Error('Fixture is immutable') } } } : { initialFiles: { '/workspace/main.py': source } }) } }
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
      <Instance id={`qa-${program}`} source={benchmarkSource(PROGRAMS[program] ?? PROGRAMS.shapes)} />
    </div>,
  )
}
