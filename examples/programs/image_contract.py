"""An original small image fixture, usable without uploaded images."""
from simpleimage import SimpleImage
from graphics import Canvas

image = SimpleImage.blank(3, 2)
image.set_rgb(1, 0, 3.9, -2, 999)
assert image.get_pix(1, 0) == (3, 0, 255)
original = image.copy()
original.show('Original')
for pixel in image:
    pixel.red = 255 - pixel.red
image.show('Result')
image.save('result.png')
reloaded = SimpleImage('result.png')
assert reloaded.get_pix(1, 0) == image.get_pix(1, 0)
canvas = Canvas(400, 300, 'Image sprite')
sprite = canvas.create_image(10, 10, image, width=180, height=120, sampling='nearest')
canvas.create_rectangle(5, 5, 200, 140, outline='navy', width=2)
assert canvas.get_width(sprite) == 180
canvas.move(sprite, 20, 20)
assert canvas.get_left_x(sprite) == 30
print('IMAGE_CONTRACT_PASS')
