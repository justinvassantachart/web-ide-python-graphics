from graphics import Canvas
c = Canvas(480, 280, title="Opacity")
colors = ["crimson", "orange", "gold", "seagreen", "royalblue", "rebeccapurple", "#00bcd4", "rgb(240,98,146)"]
for i, col in enumerate(colors):
    c.create_rectangle(10 + i * 58, 20, 58 + i * 58, 120, fill=col)
    c.create_rectangle(10 + i * 58, 130, 58 + i * 58, 230, fill=col).set_opacity(0.4)
c.create_text(240, 250, "full vs 40% opacity", anchor="center", font_size=13)
c.get_event(timeout=20)
