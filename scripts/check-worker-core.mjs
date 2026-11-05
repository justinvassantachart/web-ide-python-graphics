import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import { assertHeadlessGraphicsWorker } from '../consumer-check/app/worker-boundary.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
await mkdir(path.join(root, '.qa'), { recursive: true })
const scratch = await mkdtemp(path.join(root, '.qa', 'worker-core-'))
try {
  await writeFile(path.join(scratch, 'index.html'), '<script type="module" src="/main.js"></script>')
  await writeFile(path.join(scratch, 'main.js'), 'new Worker(new URL("./worker.js", import.meta.url), {type:"module"});')
  const compile = async entry => {
    await writeFile(path.join(scratch, 'worker.js'), `import * as graphics from ${JSON.stringify(path.join(root, 'dist', entry))}; self.postMessage(Object.keys(graphics));`)
    return build({
      root: scratch, configFile: false, logLevel: 'error',
      worker: { format: 'es', plugins: () => [assertHeadlessGraphicsWorker()] },
      build: { write: false, target: 'esnext' },
    })
  }
  await compile('core.js')
  await compile('transport.js')
  // Negative control: keep every root export so the assertion must catch React
  // rather than passing merely because a fixture forgot to use its imports.
  await assert.rejects(() => compile('index.js'), /Worker retained forbidden (framework modules|DOM code)/)
  console.log('PASS: actual Vite core/transport workers retain no React/DOM/editor code; UI-entry negative control is rejected')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
