"""Repeated saves, discarded objects, and immutable batched sprite ownership."""
import gc
from graphics import Canvas
from simpleimage import SimpleImage

image = SimpleImage.blank(800, 600)
for index in range(100):
    image.set_rgb(0, 0, index, 2, 3)
    image.save('./repeated.png')
assert SimpleImage('/repeated.png').get_pix(0, 0) == (99, 2, 3)
image.close()
for index in range(300):
    discarded = SimpleImage.blank(1, 1)
    discarded._upload()
    del discarded
    gc.collect()

canvas = Canvas(200, 100, 'Two immutable image revisions')
canvas._conn.command('frame_begin')
image = SimpleImage.blank(1, 1, 'red')
canvas.create_image(0, 0, image, width=100, height=100)
image.set_rgb(0, 0, 0, 0, 255)
canvas.create_image(100, 0, image, width=100, height=100)
image.close()
canvas._conn.command('frame_end')
canvas.update()
print('IMAGE_LIFETIMES_PASS saves=100 discarded=300')
