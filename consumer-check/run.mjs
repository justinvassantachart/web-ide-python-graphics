// Packed clean-consumer check. Packs web-ide + the companion, installs BOTH from
// tarballs into a temp app (bare specifiers only), typechecks, and builds.
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const repoRoot = path.resolve(pkgRoot, '../..')

function sh(cmd, args, cwd, timeout = 900000) {
  console.log(`\n$ (${path.relative(repoRoot, cwd)}) ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, env: process.env })
  if (r.stdout) process.stdout.write(r.stdout.slice(-1500))
  if (r.status !== 0 && r.stderr) process.stderr.write(r.stderr.slice(-3000))
  return r
}

function pack(dir, dest) {
  const r = sh('npm', ['pack', '--pack-destination', dest, '--silent'], dir)
  if (r.status !== 0) throw new Error(`npm pack failed in ${dir}`)
  return path.join(dest, r.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1))
}

async function main() {
  const work = await mkdtemp(path.join(tmpdir(), 'pg-consumer-'))
  const artifacts = path.join(work, 'artifacts')
  const app = path.join(work, 'app')
  try {
    await mkdir(artifacts, { recursive: true })
    const webide = pack(repoRoot, artifacts)
    const companion = pack(pkgRoot, artifacts)
    console.log('packed:', path.basename(webide), '+', path.basename(companion))

    await cp(path.join(here, 'app'), app, { recursive: true })

    // Generate programs.ts from the committed example programs.
    const programsDir = path.join(pkgRoot, 'examples/programs')
    const read = (f) => readFile(path.join(programsDir, f), 'utf8')
    const programs = {
      shapes: await read('shapes.py'), bounce: await read('bounce.py'),
      paint: await read('paint.py'), turtle: await read('turtle_spiral.py'),
      hello: 'print("hello from python, no graphics")\n',
    }
    await writeFile(path.join(app, 'src/programs.ts'),
      `export type ProgramKey = ${Object.keys(programs).map((k) => `'${k}'`).join(' | ')}\n`
      + `export const PROGRAMS: Record<ProgramKey, string> = {\n`
      + Object.entries(programs).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')
      + `\n}\n`)

    await writeFile(path.join(app, 'package.json'), JSON.stringify({
      name: 'python-graphics-packed-consumer', private: true, version: '0.0.0', type: 'module',
      scripts: { build: 'tsc -p tsconfig.json && tsc -p tsconfig.nodenext.json && vite build' },
      dependencies: {
        react: '^19.2.0', 'react-dom': '^19.2.0',
        'web-ide': `file:${webide}`, '@web-ide/python-graphics': `file:${companion}`,
      },
      devDependencies: {
        '@types/react': '^19.2.7', '@types/react-dom': '^19.2.3', '@vitejs/plugin-react': '^5.1.1',
        buffer: '6.0.3', events: '3.3.0', 'path-browserify': '1.0.1', process: '0.11.10',
        'stream-browserify': '3.0.0', typescript: '~5.9.3', vite: '^7.3.1', 'vite-plugin-wasm': '^3.5.0',
      },
    }, null, 2))

    if (sh('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], app).status !== 0) throw new Error('install failed')
    if (sh('npm', ['run', 'build'], app).status !== 0) throw new Error('build failed')
    const dist = await readdir(path.join(app, 'dist')).catch(() => [])
    console.log('\nconsumer dist:', dist.join(', '))
    console.log('\nPACKED CONSUMER: PASS (two tarballs installed by bare name, typechecked, production build succeeded)')
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
