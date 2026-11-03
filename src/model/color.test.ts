import { describe, expect, it } from 'vitest'
import { isSafeColor, validateColor } from './color'
import { ProtocolError } from '../protocol/codec'

describe('color validation', () => {
  it('accepts named, hex and numeric rgb colors', () => {
    for (const ok of ['red', 'CornflowerBlue', '#abc', '#aabbcc', '#aabbccdd', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)']) {
      expect(isSafeColor(ok)).toBe(true)
    }
  })

  it('rejects injection vectors and malformed values', () => {
    for (const bad of ['url(x)', 'red; background:url(x)', 'expression(1)', 'var(--x)', '#gg', 'rgb(300,0,0)', '', 'x'.repeat(65)]) {
      expect(isSafeColor(bad)).toBe(false)
    }
  })

  it('treats null/none/empty as no paint', () => {
    expect(validateColor(null, 'fill')).toBe('none')
    expect(validateColor(undefined, 'fill')).toBe('none')
    expect(validateColor('none', 'fill')).toBe('none')
    expect(validateColor('  ', 'fill')).toBe('none')
  })

  it('throws a ProtocolError on an unsafe color', () => {
    expect(() => validateColor('url(evil)', 'fill')).toThrow(ProtocolError)
    expect(() => validateColor(42, 'fill')).toThrow(ProtocolError)
  })
})
