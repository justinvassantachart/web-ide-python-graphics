"""Adapted browser Sand shell. Supply student simulation functions in step().

Original UI adaptation, not a completed homework solution. Default controls,
brush and pacing match the teaching workload; image pixels travel once/frame.
"""
from graphics import Canvas, Image
from grid import Grid
import time

WIDTH, HEIGHT, CELL_SIZE = 50, 50, 14
FRAME_MS = 30
COLORS = {None: (255, 255, 255), 's': (235, 190, 65), 'r': (90, 90, 100)}

def step(grid, gravity, brownian, strength):
    """Call the student's gravity/Brownian functions here; keep their doctests."""
    return grid

def paint(grid, point, mode):
    radius = 4 if mode == 'BigErase' else 0
    value = {'Sand': 's', 'Rock': 'r', 'Erase': None, 'BigErase': None}[mode]
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            x, y = point[0] + dx, point[1] + dy
            if dx * dx + dy * dy <= radius * radius and grid.in_bounds(x, y): grid.set(x, y, value)

def main():
    grid = Grid(WIDTH, HEIGHT)
    canvas = Canvas(WIDTH * CELL_SIZE, HEIGHT * CELL_SIZE, 'Sand')
    image = Image.blank(WIDTH, HEIGHT)
    sprite = canvas.create_image(0, 0, image, width=WIDTH * CELL_SIZE, height=HEIGHT * CELL_SIZE, sampling='nearest')
    brush = canvas.create_rectangle(0, 0, CELL_SIZE, CELL_SIZE, outline='red')
    fps = canvas.create_text(4, 4, 'FPS', color='navy')
    gravity = canvas.create_checkbox('Gravity', True)
    brownian = canvas.create_checkbox('Brownian', True)
    strength = canvas.create_slider('Brownian strength', 0, 100, 20)
    mode = canvas.create_choice('Brush', ['Sand', 'Rock', 'Erase', 'BigErase'], 'Sand')
    values = {gravity: True, brownian: True, strength: 20, mode: 'Sand'}
    painting, point = False, (0, 0)
    previous_frame = time.monotonic() - FRAME_MS / 1000
    while canvas.is_open():
        started = time.monotonic()
        event = canvas.poll_event()
        while event is not None:
            if event.type == 'controlchange': values[event.control_id] = event.value
            if event.type in ('mousedown', 'mousedrag', 'mousemove', 'mouseup'):
                point = (int(event.x // CELL_SIZE), int(event.y // CELL_SIZE))
                if event.type == 'mousedown': painting = True
                # Paint the event before draining a following release: even a
                # quick click must leave a mark. Held brushes also paint below.
                if event.type in ('mousedown', 'mousedrag') and painting:
                    paint(grid, point, values[mode])
                if event.type == 'mouseup': painting = False
                canvas.moveto(brush, point[0] * CELL_SIZE, point[1] * CELL_SIZE)
            event = canvas.poll_event()
        if painting: paint(grid, point, values[mode])
        grid = step(grid, values[gravity], values[brownian], values[strength])
        pixels = bytearray()
        for y in range(HEIGHT):
            for x in range(WIDTH): pixels.extend(COLORS[grid.get(x, y)])
        image.set_rgb_data(pixels)
        canvas.set_image(sprite, image)
        canvas.set_text(fps, 'FPS %.1f' % (1 / max(0.001, started - previous_frame)))
        previous_frame = started
        canvas.pause(max(0, FRAME_MS - (time.monotonic() - started) * 1000))

if __name__ == '__main__': main()
