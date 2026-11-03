// Placeholder. consumer-check/run.mjs regenerates this from ../examples/programs
// and ../qa-programs in the temp/kept build. Committed so the app typechecks when
// opened in place.
export type ProgramKey =
  | 'shapes' | 'bounce' | 'paint' | 'turtle' | 'hello' | 'noimport' | 'mutation' | 'events'
  | 'error' | 'tiny' | 'tall' | 'huge' | 'anchors' | 'opacity' | 'nodraw' | 'multi'
export const PROGRAMS: Record<ProgramKey, string> = Object.fromEntries(
  ([
    'shapes', 'bounce', 'paint', 'turtle', 'hello', 'noimport', 'mutation', 'events',
    'error', 'tiny', 'tall', 'huge', 'anchors', 'opacity', 'nodraw', 'multi',
  ] as const).map((key) => [key, `print("placeholder program: ${key}")\n`]),
) as Record<ProgramKey, string>
