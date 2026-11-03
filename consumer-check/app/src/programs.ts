// Placeholder. consumer-check/run.mjs regenerates this from ../examples/programs
// in the temp build. Committed so the app typechecks when opened in place.
export type ProgramKey = 'shapes' | 'bounce' | 'paint' | 'turtle' | 'hello'
export const PROGRAMS: Record<ProgramKey, string> = {
  shapes: 'from graphics import Canvas\nCanvas(200, 120).create_rectangle(10, 10, 90, 70, fill="skyblue")\n',
  bounce: 'from graphics import Canvas\nc = Canvas(200, 120)\n',
  paint: 'from graphics import Canvas\nc = Canvas(200, 120)\n',
  turtle: 'from graphics.turtle import Turtle\nt = Turtle(width=200, height=200)\n',
  hello: 'print("hello from python, no graphics")\n',
}
