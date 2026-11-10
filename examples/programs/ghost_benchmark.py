"""Original Ghost-scale workload: directory input and local tuple pixel loops."""
from simpleimage import SimpleImage
import os
import time

DIRECTORY = 'ghost-inputs'
started = time.monotonic()
images = [SimpleImage(DIRECTORY + '/' + name) for name in sorted(os.listdir(DIRECTORY)) if name.endswith('.png')]
assert len(images) == 9
assert all((image.width, image.height) == (1000, 750) for image in images)
result = SimpleImage.blank(1000, 750)
loaded = time.monotonic()
for y in range(result.height):
    for x in range(result.width):
        colors = [image.get_pix(x, y) for image in images]
        # Nearest-to-average RGB, expressed with integer squared distances.
        # Scaling each difference by count preserves the chosen closest pixel.
        red_total = green_total = blue_total = 0
        for red, green, blue in colors:
            red_total += red
            green_total += green
            blue_total += blue
        count = len(colors)
        closest, best = colors[0], 10**20
        for color in colors:
            dr = color[0]*count - red_total
            dg = color[1]*count - green_total
            db = color[2]*count - blue_total
            distance = dr*dr + dg*dg + db*db
            if distance < best: closest, best = color, distance
        result.set_pix(x, y, closest)
finished = time.monotonic()
result.show('Ghost-scale result')
print('GHOST_BENCHMARK_PASS load=%.3f algorithm=%.3f total=%.3f pixels=%d' % (loaded-started, finished-loaded, time.monotonic()-started, 1000*750*9))
