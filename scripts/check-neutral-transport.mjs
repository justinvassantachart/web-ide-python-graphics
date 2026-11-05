// Real CPython and the built TypeScript host exchange bytes over two pipes.
// The guest uses only the published Python API, with public-device I/O adapted
// to the pipes; no graphics imports and no mocked service response envelopes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DeviceMultiplexer, createJsonService } from '../dist/transport.js'

const sourceRoot = fileURLToPath(new URL('../src/python', import.meta.url))
const program = `
import os, sys
sys.path.insert(0, ${JSON.stringify(sourceRoot)})
import web_ide_transport as transport
read, write = os.read, os.write
transport.os.open = lambda path, flags: 99
transport.os.read = lambda fd, size: read(0, min(size, 3))
transport.os.write = lambda fd, data: write(1, data[:5])
transport.os.close = lambda fd: None
connection = transport.get_connection()
one, two = connection.service('echo'), connection.service('length')
assert one.request('echo', value='hello') == 'hello'
assert two.request('length', value='abc') == 3
assert one.request('echo', value=0) == 0
assert 'graphics' not in sys.modules
one.close()
assert two.request('length', value='still open') == 10
sys.stderr.write('NEUTRAL_TWO_SERVICES_PASS\\n')
`
const child = spawn('python3', ['-c', program], { stdio: ['pipe', 'pipe', 'pipe'] })
const controller = new AbortController()
let stderr = ''
child.stderr.on('data', chunk => { stderr += chunk.toString() })
const mux = new DeviceMultiplexer({
  services: [
    createJsonService({ channel: 9, capability: 'echo', version: 1, handleRequest: message => message.value }),
    createJsonService({ channel: 4, capability: 'length', version: 1, handleRequest: message => String(message.value).length }),
  ],
  onFatal(error) { stderr += error.message; child.kill() },
})
const cleanup = mux.opener({
  signal: controller.signal,
  onData(listener) { child.stdout.on('data', listener); return () => child.stdout.off('data', listener) },
  write(chunk) { return new Promise((resolve, reject) => child.stdin.write(chunk, error => error ? reject(error) : resolve())) },
})
const timeout = setTimeout(() => child.kill(), 10_000)
const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
clearTimeout(timeout)
controller.abort()
cleanup()
assert.equal(code, 0, stderr)
assert.match(stderr, /NEUTRAL_TWO_SERVICES_PASS/)
console.log('PASS: built neutral TypeScript transport + CPython, two independent services, alternating requests, partial I/O, and no graphics import')
