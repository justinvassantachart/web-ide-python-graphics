from graphics import Canvas
c = Canvas(300, 1200, title="Tall", background="#eef6ff")
for i in range(12):
    c.create_rectangle(20, 20 + i * 95, 280, 90 + i * 95, fill="steelblue" if i % 2 else "lightsteelblue")
    c.create_text(150, 55 + i * 95, "row %d" % i, anchor="center", color="white" if i % 2 else "black")
c.get_event(timeout=20)
