"""Small Stanford DrawCanvas adapter over the existing retained graphics canvas.

Geometry uses x/y/width/height. update() commits a complete frame; mainloop()
waits on cancellable events. No Tkinter, JavaScript callbacks, or busy waiting.
"""
from graphics import Canvas, GraphicsError


def _color(value):
    if isinstance(value, (tuple, list)) and len(value) == 3:
        from graphics.image import _channel
        return 'rgb(%d,%d,%d)' % tuple(_channel(n) for n in value)
    return value


class DrawCanvas:
    def __init__(self, width, height, title=''):
        self.canvas = Canvas(width, height, title)
        self.width, self.height = self.canvas.width, self.canvas.height
        self.canvas._conn.command('frame_begin')

    def draw_line(self, x1, y1, x2, y2, color='black', width=1):
        return self.canvas.create_line(x1, y1, x2, y2, _color(color), width)

    def draw_rect(self, x, y, width, height, color='black'):
        return self.canvas.create_rectangle(x, y, x + width, y + height, outline=_color(color))

    def fill_rect(self, x, y, width, height, color='black'):
        return self.canvas.create_rectangle(x, y, x + width, y + height, fill=_color(color), outline=None)

    def draw_oval(self, x, y, width, height, color='black'):
        return self.canvas.create_oval(x, y, x + width, y + height, outline=_color(color))

    def fill_oval(self, x, y, width, height, color='black'):
        return self.canvas.create_oval(x, y, x + width, y + height, fill=_color(color), outline=None)

    def draw_string(self, x, y, text, color='black', font_size=16):
        return self.canvas.create_text(x, y, text, color=_color(color), font_size=font_size)

    def erase(self):
        self.canvas.clear()

    def update(self):
        self.canvas.update()
        self.canvas._conn.command('frame_begin')

    def mainloop(self):
        self.canvas.mainloop()

    def pause(self, milliseconds):
        self.update()
        self.canvas.pause(milliseconds)

    def close(self):
        self.canvas.close()
