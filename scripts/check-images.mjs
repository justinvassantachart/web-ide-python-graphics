// Real CPython + actual mux/core: specifically catches successful-reply abort
// accidentally invalidating multi-request image leases. Browser codecs are
// separately verified; this fixture injects a deterministic 1-pixel codec.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DeviceMultiplexer, createJsonService, GraphicsController } from '../dist/core.js'

const scratch = await mkdtemp(`${tmpdir()}/python-image-contract-`)
const sourceRoot = fileURLToPath(new URL('../src/python', import.meta.url))
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQZkAAAAASUVORK5CYII=', 'base64'))
let encodedPixels
const graphics = new GraphicsController(undefined, { codec: {
  async decode() { return { width: 1, height: 1, data: new Uint8Array(encodedPixels ?? [255, 255, 255, 255]) } },
  async encode(pixels) { encodedPixels = [...pixels.data]; return { bytes: png.slice(), mediaType: 'image/png' } },
} })
const program = `
import os, sys
sys.path.insert(0, ${JSON.stringify(sourceRoot)})
import web_ide_transport as transport
read, write, open_fd = os.read, os.write, os.open
transport.os.open = lambda path, flags: 99 if path == '/dev/debugger-sh-host' else open_fd(path, flags)
transport.os.read = lambda fd, size: read(0, min(size, 257)) if fd == 99 else read(fd, size)
transport.os.write = lambda fd, data: write(1, data[:193]) if fd == 99 else write(fd, data)
transport.os.close = lambda fd: None
connection = transport.get_connection()
echo = connection.service('echo')
assert echo.request('echo', value='before') == 'before'
from simpleimage import SimpleImage
image = SimpleImage.blank(1, 1)
image.get_pixel(0, 0).red = 42
image.show('Original')
image.get_pixel(0, 0).blue = 17
image.show('Updated')
image.save('saved.png')
assert open('saved.png', 'rb').read().startswith(b'\\x89PNG')
loaded = SimpleImage('saved.png')
assert loaded.get_pix(0, 0) == (42, 255, 17)
assert echo.request('echo', value='after') == 'after'
sys.stderr.write('IMAGE_MUX_CONTRACT_PASS\\n')
`
const child = spawn('python3', ['-c', program], { cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] })
const abort = new AbortController()
let stderr = ''
child.stderr.on('data', chunk => { stderr += chunk.toString() })
const mux = new DeviceMultiplexer({ services: [...graphics.hostServices,
  createJsonService({ channel: 4, capability: 'echo', version: 1, handleRequest: request => request.value }),
], onFatal(error) { stderr += error.message; child.kill() } })
const cleanup = mux.opener({ signal: abort.signal,
  onData(listener) { child.stdout.on('data', listener); return () => child.stdout.off('data', listener) },
  write(chunk) { return new Promise((resolve, reject) => child.stdin.write(chunk, error => error ? reject(error) : resolve())) },
})
const timeout = setTimeout(() => child.kill(), 20_000)
try {
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
  assert.equal(code, 0, stderr)
  assert.match(stderr, /IMAGE_MUX_CONTRACT_PASS/)
  abort.abort(); cleanup()
  const snapshot = graphics.images.service.snapshot()
  assert.equal(snapshot.presentations.length, 1)
  assert.equal(snapshot.outputs.length, 1)
  assert.deepEqual([...graphics.images.service.getResource(snapshot.presentations[0].resource).data], [42, 255, 17, 255])
  assert.deepEqual([...(await graphics.images.service.downloadPresentation(snapshot.presentations[0].presentationId)).bytes], [...png])
  console.log('PASS: CPython + real mux, shared image leases across successful replies, local pixels, show replacement, real guest save/reload, final download, and service reuse')
} finally {
  clearTimeout(timeout); abort.abort(); cleanup(); graphics.dispose(); await rm(scratch, { recursive: true, force: true })
}
