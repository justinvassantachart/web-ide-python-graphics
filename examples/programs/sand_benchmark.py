"""Original compact raster/control pacing workload; no homework algorithm."""
from graphics import Canvas, Image
import time
WIDTH, HEIGHT, SCALE, FRAMES = 50, 50, 10, 180
SECONDS = 0
canvas = Canvas(WIDTH*SCALE, HEIGHT*SCALE, 'Sand controls benchmark')
image = Image.blank(WIDTH, HEIGHT)
sprite = canvas.create_image(0, 0, image, width=WIDTH*SCALE, height=HEIGHT*SCALE, sampling='nearest')
canvas.create_checkbox('Gravity', True)
canvas.create_checkbox('Brownian', True)
canvas.create_slider('Brownian strength', 0, 100, 20)
canvas.create_choice('Brush', ['Sand','Rock','Erase','BigErase'], 'Sand')
field = canvas.create_text_field('Name', 'Sand')
button = canvas.create_button('Submit')
frame_times = []
phases = [0.0, 0.0, 0.0, 0.0]
started = time.monotonic()
frame = 0
while (time.monotonic() - started < SECONDS) if SECONDS else (frame < FRAMES):
    before = time.monotonic()
    pixels = bytearray()
    for y in range(HEIGHT):
        for x in range(WIDTH): pixels.extend(((x+frame)%256, (y*5)%256, 100))
    image.set_rgb_data(pixels)
    pixels_done = time.monotonic()
    canvas.set_image(sprite, image)
    upload_done = time.monotonic()
    while True:
        event = canvas.poll_event()
        if event is None: break
        if event.type in ('controlsubmit','controlclick'): print('CONTROL_EVENT',event.type,event.value)
    events_done = time.monotonic()
    canvas.pause(max(0, 16 - (time.monotonic() - before) * 1000))
    phases[0] += pixels_done-before
    phases[1] += upload_done-pixels_done
    phases[2] += events_done-upload_done
    phases[3] += time.monotonic()-events_done
    frame_times.append(time.monotonic()-before)
    frame += 1
frame_times.sort()
print('SAND_BENCHMARK_PASS fps=%.2f p95=%.4f frames=%d' % (frame/(time.monotonic()-started),frame_times[int(frame*.95)],frame))

print('SAND_PHASES pixel=%.4f upload=%.4f events=%.4f pause=%.4f' % tuple(value/frame for value in phases))
