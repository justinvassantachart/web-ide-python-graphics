import { ProtocolError } from '../protocol/codec'

export type ControlValue = string | number | boolean
export interface ControlDescriptor {
  readonly id: string
  readonly kind: 'text' | 'button' | 'checkbox' | 'slider' | 'choice'
  readonly label: string
  readonly value: ControlValue
  readonly options?: readonly string[]
  readonly min?: number
  readonly max?: number
}
export const MAX_CONTROLS = 64

export function parseControl(value: unknown): ControlDescriptor {
  const fail = (): never => { throw new ProtocolError('bad_request', 'Invalid graphics control') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const data = value as Record<string, unknown>
  if (typeof data.id !== 'string' || !data.id || data.id.length > 128 || typeof data.label !== 'string' || data.label.length > 256) return fail()
  const base = { id: data.id, label: data.label }
  switch (data.kind) {
    case 'text': case 'button':
      if (typeof data.value !== 'string' || data.value.length > 4096) return fail()
      return { ...base, kind: data.kind, value: data.value }
    case 'checkbox':
      if (typeof data.value !== 'boolean') return fail()
      return { ...base, kind: data.kind, value: data.value }
    case 'slider':
      if (!Number.isSafeInteger(data.min) || !Number.isSafeInteger(data.max) || !Number.isSafeInteger(data.value)) return fail()
      if ((data.min as number) > (data.max as number) || (data.min as number) < -1000000 || (data.max as number) > 1000000 || (data.value as number) < (data.min as number) || (data.value as number) > (data.max as number)) return fail()
      return { ...base, kind: 'slider', value: data.value as number, min: data.min as number, max: data.max as number }
    case 'choice':
      if (!Array.isArray(data.options) || !data.options.length || data.options.length > 32 || data.options.some(v => typeof v !== 'string' || !v || v.length > 128) || new Set(data.options).size !== data.options.length || typeof data.value !== 'string' || !data.options.includes(data.value)) return fail()
      return { ...base, kind: 'choice', value: data.value, options: [...data.options] as string[] }
    default: return fail()
  }
}
