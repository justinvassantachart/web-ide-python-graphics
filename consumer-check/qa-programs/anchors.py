from graphics import Canvas
c = Canvas(480, 320, title="Anchors")
cx, cy = 240, 160
c.create_line(cx, 20, cx, 300, color="#bbb")
c.create_line(40, cy, 440, cy, color="#bbb")
for a in ["nw", "n", "ne", "w", "center", "e", "sw", "s", "se"]:
    t = c.create_text(cx, cy, a, color="navy", anchor=a, font_size=15)
    b = t.get_bounds()
    c.create_rectangle(b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"], outline="rgba(255,0,0,0.5)")
c.get_event(timeout=20)
