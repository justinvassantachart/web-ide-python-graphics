import * as graphics from '@web-ide/python-graphics'
import type { RuntimeHostDevice } from 'web-ide'

// A strict NodeNext compile (skipLibCheck: false) of the installed declaration
// graph proves the package's .d.ts files resolve without bundler-only behavior:
// every relative specifier must carry an explicit extension.
void graphics

const plugin = graphics.createPythonGraphicsPlugin({ panelTitle: 'Graphics' })
void plugin.contributes?.panels?.[0]?.id

// The mux opener is assignable from web-ide's structural device type.
const mux = new graphics.DeviceMultiplexer({ services: [], onFatal() {} })
const opener: (device: RuntimeHostDevice) => void | (() => void) = mux.opener
void opener

const frame = graphics.encodeFrame(graphics.CHANNEL_GRAPHICS, graphics.encodeJson({ op: 'metrics', id: 1 }))
const [parsed] = new graphics.FrameReader().push(frame)
void parsed?.channel

import { createJsonService, TRANSPORT_PYTHON_SOURCES } from '@web-ide/python-graphics/transport'
const independent = createJsonService({ channel: 2, capability: 'echo', version: 1, handleRequest: message => message.value })
void independent
void TRANSPORT_PYTHON_SOURCES
