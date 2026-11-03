"""Mouse drag draws; keyboard changes color. Input is focus-scoped."""
from graphics import Canvas

c = Canvas(400, 300, title="Paint", background="white")
c.create_text(200, 16, "drag to draw; press r / g / b", color="gray", anchor="center")

color = "black"
last = None
while c.is_open():
    event = c.get_event()
    if event is None:
        continue
    if event.type == "keydown":
        color = {"r": "crimson", "g": "seagreen", "b": "royalblue"}.get(event.key, color)
    elif event.type == "mousedown":
        last = (event.x, event.y)
    elif event.type == "mousedrag" and last is not None:
        c.create_line(last[0], last[1], event.x, event.y, color=color, width=3)
        last = (event.x, event.y)
    elif event.type == "mouseup":
        last = None
