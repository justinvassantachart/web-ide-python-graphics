/**
 * Strict color validation. Only a fixed named allow-list, `#hex` (3/4/6/8), and
 * numeric `rgb()/rgba()` are accepted. This forbids `url(...)`, CSS functions,
 * `expression(...)`, custom properties, and any other injection vector: the
 * value is only ever placed into an SVG `fill`/`stroke` attribute.
 */

import { ProtocolError } from '../protocol/codec'

// CSS Color Module Level 4 extended color keywords (lowercased) + transparent.
const NAMED_COLORS = new Set<string>([
  'transparent', 'currentcolor',
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood',
  'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray',
  'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta', 'darkolivegreen',
  'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue',
  'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen',
  'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue',
  'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace',
  'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod',
  'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
  'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red',
  'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
  'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
  'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle',
  'tomato', 'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow',
  'yellowgreen',
])

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i

/** Returns true if `value` is an accepted, injection-safe color string. */
export function isSafeColor(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return false
  }
  const lower = value.trim().toLowerCase()
  if (NAMED_COLORS.has(lower)) return true
  if (HEX_RE.test(lower)) return true
  if (RGB_RE.test(lower)) {
    // Reject out-of-range channels (regex allows up to 999).
    const nums = lower
      .slice(lower.indexOf('(') + 1, lower.lastIndexOf(')'))
      .split(',')
      .slice(0, 3)
      .map((part) => Number(part.trim()))
    return nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)
  }
  return false
}

/**
 * Validates a color, returning a normalized string. `null`/`undefined`/`'none'`
 * mean "no paint" and return `'none'`. Throws {@link ProtocolError} otherwise.
 */
export function validateColor(
  value: unknown,
  field: string,
): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value !== 'string') {
    throw new ProtocolError('bad_request', `${field} must be a color string`)
  }
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return 'none'
  if (!isSafeColor(trimmed)) {
    throw new ProtocolError('bad_request', `${field} is not an allowed color: ${value}`)
  }
  return trimmed
}
