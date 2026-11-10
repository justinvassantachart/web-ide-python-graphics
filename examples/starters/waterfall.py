"""Adapted paced Waterfall shell; student step() owns the simulation algorithm."""
from graphics import Canvas, Image
from grid import Grid
import time
WIDTH, HEIGHT, CELL_SIZE = 50, 50, 14
FRAME_MS = 30

def step(grid):
    """Call student simulation code here."""
    return grid

def main():
    grid = Grid(WIDTH, HEIGHT)
    canvas = Canvas(WIDTH * CELL_SIZE, HEIGHT * CELL_SIZE, 'Waterfall')
    image = Image.blank(WIDTH, HEIGHT)
    sprite = canvas.create_image(0, 0, image, width=WIDTH * CELL_SIZE, height=HEIGHT * CELL_SIZE, sampling='nearest')
    while canvas.is_open():
        started = time.monotonic()
        grid = step(grid)
        pixels = bytearray()
        for y in range(HEIGHT):
            for x in range(WIDTH): pixels.extend((30, 100, 220) if grid.get(x, y) else (255, 255, 255))
        image.set_rgb_data(pixels)
        canvas.set_image(sprite, image)
        canvas.pause(max(0, FRAME_MS - (time.monotonic() - started) * 1000))

if __name__ == '__main__': main()
