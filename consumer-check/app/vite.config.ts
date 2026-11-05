import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import { assertHeadlessGraphicsWorker } from './worker-boundary.mjs'

// The runtime needs cross-origin isolation (SharedArrayBuffer). Vite's native
// header options apply to both `vite dev` and `vite preview`.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react(), wasm()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  resolve: {
    alias: {
      'node:buffer': 'buffer', 'node:events': 'events',
      'node:path': 'path-browserify', 'node:stream': 'stream-browserify',
    },
    dedupe: ['react', 'react-dom'],
  },
  worker: { format: 'es', plugins: () => [wasm(), assertHeadlessGraphicsWorker()] },
  optimizeDeps: { exclude: ['debugger-sh'] },
  build: { target: 'esnext' },
})
