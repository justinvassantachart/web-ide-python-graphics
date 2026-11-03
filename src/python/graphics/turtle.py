"""A small *turtle-style* drawing adapter built on :class:`graphics.Canvas`.

This is **not** Python's standard-library ``turtle`` and does not aim for
parity. It offers the common pen-movement subset (forward/back, left/right,
goto, pen up/down, color, size, heading) by drawing line segments on a Canvas.
Calls that the adapter does not implement raise :class:`GraphicsError` with a
clear message rather than failing silently or pretending to work.

Coordinates use the Canvas system (origin top-left, y increasing downward) but
turtle motion treats the heading like the standard turtle (0 degrees = east,
positive angles turn left/counter-clockwise), so ``forward`` after ``left(90)``
moves up the screen.
"""

import math

from . import Canvas, GraphicsError

__all__ = ["Turtle"]

_UNSUPPORTED = (
    "begin_fill", "end_fill", "stamp", "clone", "shape", "shapesize",
    "begin_poly", "end_poly", "fill", "tracer", "undo",
)


class Turtle:
    def __init__(self, canvas=None, width=400, height=400):
        self._canvas = canvas if canvas is not None else Canvas(width, height, title="Turtle")
        self._x = self._canvas.width / 2
        self._y = self._canvas.height / 2
        self._heading = 0.0
        self._pen_down = True
        self._color = "black"
        self._width = 1

    # ---- movement ---------------------------------------------------------

    def forward(self, distance):
        radians = math.radians(self._heading)
        nx = self._x + distance * math.cos(radians)
        ny = self._y - distance * math.sin(radians)
        self.goto(nx, ny)
        return self

    def backward(self, distance):
        return self.forward(-distance)

    def goto(self, x, y):
        if self._pen_down:
            self._canvas.create_line(self._x, self._y, x, y, color=self._color, width=self._width)
        self._x, self._y = x, y
        return self

    def left(self, angle):
        self._heading = (self._heading + angle) % 360
        return self

    def right(self, angle):
        self._heading = (self._heading - angle) % 360
        return self

    def setheading(self, angle):
        self._heading = angle % 360
        return self

    def home(self):
        return self.goto(self._canvas.width / 2, self._canvas.height / 2)

    # ---- pen --------------------------------------------------------------

    def penup(self):
        self._pen_down = False
        return self

    def pendown(self):
        self._pen_down = True
        return self

    def pencolor(self, color):
        self._color = color
        return self

    def pensize(self, width):
        self._width = width
        return self

    def dot(self, size=6, color=None):
        radius = size / 2
        paint = color if color is not None else self._color
        self._canvas.create_oval(self._x - radius, self._y - radius, self._x + radius, self._y + radius,
                                 fill=paint, outline=paint)
        return self

    def write(self, text, font_size=16, color=None):
        self._canvas.create_text(self._x, self._y, str(text), color=color or self._color,
                                 font_size=font_size, anchor="sw")
        return self

    # ---- state ------------------------------------------------------------

    def position(self):
        return (self._x, self._y)

    def heading(self):
        return self._heading

    def speed(self, *_args):
        return self  # accepted but a no-op; pacing is via Canvas.pause

    def clear(self):
        self._canvas.clear()
        return self

    def is_open(self):
        return self._canvas.is_open()

    def pause(self, milliseconds):
        self._canvas.pause(milliseconds)
        return self

    def get_canvas(self):
        return self._canvas

    # Common aliases.
    fd = forward
    bk = backward
    back = backward
    lt = left
    rt = right
    seth = setheading
    setpos = goto
    setposition = goto
    pu = penup
    up = penup
    pd = pendown
    down = pendown
    color = pencolor
    pencolour = pencolor
    width = pensize
    pos = position

    def __getattr__(self, name):
        if name in _UNSUPPORTED:
            raise GraphicsError(
                "Turtle.%s is not supported by the turtle-style adapter; "
                "use the Canvas drawing methods instead" % name
            )
        raise AttributeError("Turtle has no attribute %r" % name)
