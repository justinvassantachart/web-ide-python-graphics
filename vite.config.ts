import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { rewriteDeclarationModuleSpecifiers } from './scripts/declaration-specifiers.mjs'

// Library build for @web-ide/python-graphics. React, react-dom and web-ide are
// peers and are externalized. The Python helper sources are inlined via `?raw`,
// so the published package carries no loose .py files and no runtime
// dependency. Declarations are emitted per-module and their relative
// specifiers are rewritten to explicit `.js` paths (scripts/
// declaration-specifiers.mjs, the same step web-ide uses) so a strict
// `moduleResolution: NodeNext` consumer resolves the declaration graph, not
// only bundler-resolution hosts.
export default defineConfig({
  plugins: [
    react(),
    dts({
      tsconfigPath: './tsconfig.json',
      include: ['src'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      insertTypesEntry: true,
      beforeWriteFile(filePath, content) {
        return {
          content: rewriteDeclarationModuleSpecifiers({
            filePath,
            content,
            sourceRoot: path.resolve(import.meta.dirname, 'src'),
            outputRoot: path.resolve(import.meta.dirname, 'dist'),
          }),
        }
      },
    }),
  ],
  build: {
    target: 'esnext',
    lib: {
      entry: {
        index: path.resolve(import.meta.dirname, 'src/index.ts'),
        transport: path.resolve(import.meta.dirname, 'src/transport/index.ts'),
      },
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
