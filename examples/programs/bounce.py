"""Animation paced by the host-timed, cancellable pause()."""
from graphics import Canvas

c = Canvas(400, 300, title="Bounce", background="#102030")
ball = c.create_oval(0, 0, 40, 40, fill="gold")
dx, dy = 4, 3
steps = 0
while c.is_open() and steps < 100000:
    ball.move(dx, dy)
    b = ball.get_bounds()
    if b["x"] <= 0 or b["x"] + b["w"] >= c.width:
        dx = -dx
    if b["y"] <= 0 or b["y"] + b["h"] >= c.height:
        dy = -dy
    c.pause(16)
    steps += 1
