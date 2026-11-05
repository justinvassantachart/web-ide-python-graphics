/** Fail on retained worker code, including otherwise-unused CommonJS wrappers. */
export function assertHeadlessGraphicsWorker() {
  return {
    name: 'assert-headless-graphics-worker',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        const forbidden = Object.entries(output.modules).filter(([id, module]) =>
          module.renderedLength > 0 && /\/node_modules\/(?:react(?:-dom)?|scheduler|web-ide|monaco-editor)(?:\/|$)/.test(id.replaceAll('\\', '/')),
        )
        if (forbidden.length) {
          throw new Error(`Worker retained forbidden framework modules: ${forbidden.map(([id]) => id).join(', ')}`)
        }
        if (/\b(?:window|document)\s*(?:\.|\[)|\b(?:HTMLElement|HTMLCanvasElement)\b/.test(output.code)) {
          throw new Error('Worker retained forbidden DOM code')
        }
      }
    },
  }
}
