// Packed clean-consumer check. Packs the companion, installs it together with a
// web-ide tarball into a temp app (bare specifiers only), typechecks under both
// bundler and strict NodeNext resolution, and production-builds.
//
// The web-ide tarball comes from WEB_IDE_TARBALL (absolute path to a packed
// web-ide-<version>.tgz, e.g. a GitHub release asset), so this check never
// assumes a monorepo or sibling checkout.
//
// Set KEEP_CONSUMER_DIR=/abs/path to build the consumer app there and keep it,
// so the browser QA matrix (docs/VERIFICATION.md) can be driven against it:
//   node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4310
// The app serves COOP/COEP headers itself; it still needs network access to
// jsDelivr (Monaco) and runno.dev (the Python WASM runtime) at run time.
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

function sh(cmd, args, cwd, timeout = 900000) {
  console.log(`\n$ (${path.relative(pkgRoot, cwd) || '.'}) ${cmd} ${args.join(' ')}`)
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

async function resolveWebIdeTarball() {
  const configured = process.env.WEB_IDE_TARBALL
  if (!configured) {
    throw new Error(
      'Set WEB_IDE_TARBALL to the absolute path of a packed web-ide tarball '
      + '(e.g. the web-ide-<version>.tgz GitHub release asset).',
    )
  }
  if (!path.isAbsolute(configured)) throw new Error('WEB_IDE_TARBALL must be an absolute path')
  const info = await stat(configured)
  if (!info.isFile()) throw new Error(`WEB_IDE_TARBALL is not a file: ${configured}`)
  return configured
}

async function loadPrograms() {
  // Example programs (documentation-grade) plus QA-only programs that the
  // browser matrix in docs/VERIFICATION.md drives via `?program=<key>`.
  const programs = {}
  const examplesDir = path.join(pkgRoot, 'examples/programs')
  const qaDir = path.join(here, 'qa-programs')
  const keyFor = (file) => path.basename(file, '.py').replace(/_spiral$/u, '')
  for (const dir of [examplesDir, qaDir]) {
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.py')).sort()) {
      programs[keyFor(file)] = await readFile(path.join(dir, file), 'utf8')
    }
  }
  const startersDir = path.join(pkgRoot, 'examples/starters')
  const gridSource = await readFile(path.join(startersDir, 'grid.py'), 'utf8')
  for (const starter of ['sand', 'waterfall']) {
    programs[`${starter}_starter`] = gridSource + '\n' + (await readFile(path.join(startersDir, `${starter}.py`), 'utf8')).replace('from grid import Grid\n', '')
  }
  programs.baby_graphics = await readFile(path.join(startersDir, 'baby_graphics.py'), 'utf8')
  return programs
}

async function main() {
  const webide = await resolveWebIdeTarball()
  const keep = process.env.KEEP_CONSUMER_DIR
  if (keep && !path.isAbsolute(keep)) throw new Error('KEEP_CONSUMER_DIR must be an absolute path')
  const work = keep ?? await mkdtemp(path.join(tmpdir(), 'pg-consumer-'))
  const artifacts = path.join(work, 'artifacts')
  const app = path.join(work, 'app')
  try {
    if (keep) await rm(work, { recursive: true, force: true })
    await mkdir(artifacts, { recursive: true })
    const companion = pack(pkgRoot, artifacts)
    console.log('web-ide tarball:', webide)
    console.log('packed companion:', path.basename(companion))

    await cp(path.join(here, 'app'), app, { recursive: true })

    const programs = await loadPrograms()
    console.log('programs:', Object.keys(programs).join(', '))
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
      ...(process.env.DEBUGGER_SH_TARBALL ? { overrides: { 'debugger-sh': `file:${process.env.DEBUGGER_SH_TARBALL}` } } : {}),
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
    if (keep) {
      console.log(`\nKept consumer app at ${app}\nPreview it with:\n  cd ${app} && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4310 --strictPort`)
    }
  } finally {
    if (!keep) await rm(work, { recursive: true, force: true })
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
