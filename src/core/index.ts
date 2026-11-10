/** Headless graphics entry: no React, renderer, plugin, or editor runtime imports. */
export { GraphicsController } from '../adapter/controller'
export type { GraphicsStatus } from '../adapter/controller'
export {
  GRAPHICS_PYTHON_SOURCES, GRAPHICS_RESOURCE_ID, GRAPHICS_PY_PATH, GRAPHICS_TURTLE_PY_PATH,
  GRAPHICS_IMAGE_PY_PATH, SIMPLEIMAGE_PY_PATH, DRAWCANVAS_PY_PATH, getPythonGraphicsAvailability, getAvailablePythonGraphicsSources, detectDesktopImageHelper,
} from './resources'
export type { MeasureFn, TextObject } from '../model/measure'

// ---- Service + multiplexer -------------------------------------------------
export { GraphicsService } from '../service/graphics-service'
export type {
  GraphicsServiceHost,
  GraphicsServiceOptions,
  GraphicsScheduler,
} from '../service/graphics-service'
export { DeviceMultiplexer } from '../mux/multiplexer'
export type { DeviceMultiplexerOptions } from '../mux/multiplexer'
export type { HostService, ServiceConnection, HostByteDevice } from '../mux/service'
export type {
  GraphicsInput,
  PointerInput,
  KeyInput,
  PointerEventKind,
  KeyEventKind,
} from '../service/events'

// ---- Retained model --------------------------------------------------------
export {
  Scene,
  geometricBounds,
  objectReferencePoint,
  translateObject,
  DEFAULT_CANVAS,
} from '../model/scene'
export type {
  SceneObject,
  SceneSnapshot,
  ObjectKind,
  Style,
  CanvasState,
  OrderMode,
} from '../model/scene'
export type { Bounds, Point, TextAnchor } from '../model/geometry'
export { isSafeColor } from '../model/color'

// ---- Wire protocol (versioned contract) ------------------------------------
export {
  FRAME_MAGIC,
  TRANSPORT_VERSION,
  FRAME_HEADER_BYTES,
  CHANNEL_CONTROL,
  CHANNEL_GRAPHICS,
  GRAPHICS_CAPABILITY,
  GRAPHICS_VERSION,
  LIMITS,
  ERROR_CODES,
} from '../protocol/constants'
export type { Limits, ErrorCode } from '../protocol/constants'
export { encodeFrame, FrameReader, FatalFrameError } from '../protocol/frames'
export type { Frame } from '../protocol/frames'
export { encodeJson, decodeJsonObject, ProtocolError } from '../protocol/codec'

// ---- Utilities -------------------------------------------------------------
export { Observable } from '../observable'

// Neutral transport is also available without the React/graphics entry point.
export { createJsonService, ServiceError } from '../transport/json-service'
export type { JsonServiceOptions } from '../transport/json-service'
export type { ServiceRequest } from '../mux/service'
export { TRANSPORT_PYTHON_SOURCES, TRANSPORT_PY_PATH } from '../transport/resources'
export { parseSceneSnapshot, isSceneSnapshot, parseGraphicsInput, isGraphicsInput } from '../validation'

export { ImageController, IMAGE_CHANNEL, IMAGE_CAPABILITY, IMAGE_VERSION } from '../adapter/image-controller'
export type { ControlDescriptor, ControlValue } from '../model/controls'
