import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

// Standalone library build for @web-ide/python-graphics. React, react-dom and
// web-ide are peers and are externalized. The Python helper sources are inlined
// via `?raw`, so the published package carries no loose .py files and no
// runtime dependency. Declarations are emitted per-module; a bundler-resolution
// consumer (the realistic Vite host) resolves the extensionless relative
// specifiers without the NodeNext rewrite that web-ide itself performs.
export default defineConfig({
  plugins: [
    react(),
    dts({
      tsconfigPath: './tsconfig.json',
      include: ['src'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      insertTypesEntry: true,
    }),
  ],
  build: {
    target: 'esnext',
    lib: {
      entry: { index: path.resolve(import.meta.dirname, 'src/index.ts') },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        /^web-ide(\/.*)?$/,
      ],
    },
  },
})
