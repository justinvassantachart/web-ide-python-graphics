"""Real uploaded files and a small chromakey fixture, no command-line arguments."""
from simpleimage import SimpleImage
from graphics import Image
import os

foreground = SimpleImage('images/foreground.png')
background = SimpleImage('images/background.jpg')
assert foreground.width == background.width == 8
assert foreground.height == background.height == 6
foreground.show('Foreground')
result = foreground.copy()
for pixel in result:
    if pixel.blue > 2 * max(pixel.red, pixel.green):
        result.set_pixel(pixel.x, pixel.y, background.get_pixel(pixel.x, pixel.y))
result.show('Composited')
os.makedirs('outputs', exist_ok=True)
result.save('outputs/chromakey.png')
reloaded = SimpleImage('outputs/chromakey.png')
assert [p.red for p in reloaded] == [p.red for p in result]
result.save('outputs/chromakey.jpg')
assert SimpleImage('outputs/chromakey.jpg').width == 8
print('BINARY_IMAGE_PIPELINE_PASS')
