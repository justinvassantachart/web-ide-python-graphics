import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}
function crossOriginIsolation(): Plugin {
  const mw = (_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v)
    next()
  }
  return { name: 'coi', configureServer: (s) => s.middlewares.use(mw), configurePreviewServer: (s) => s.middlewares.use(mw) }
}

export default defineConfig({
  plugins: [crossOriginIsolation(), react(), wasm()],
  resolve: {
    alias: {
      'node:buffer': 'buffer', 'node:events': 'events',
      'node:path': 'path-browserify', 'node:stream': 'stream-browserify',
    },
    dedupe: ['react', 'react-dom'],
  },
  worker: { format: 'es', plugins: () => [wasm()] },
  optimizeDeps: { exclude: ['debugger-sh'] },
  build: { target: 'esnext' },
})
