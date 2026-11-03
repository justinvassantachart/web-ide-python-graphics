"""Every shape, fill/outline/width, text, and a layering demo."""
from graphics import Canvas

c = Canvas(480, 320, title="Shapes", background="white")

c.create_rectangle(20, 20, 160, 120, fill="skyblue", outline="navy", width=3)
c.create_oval(180, 20, 300, 120, fill="gold", outline="darkorange", width=2)
c.create_line(20, 150, 300, 150, color="crimson", width=4)
c.create_polygon([(340, 30), (460, 30), (400, 120)], fill="mediumseagreen", outline="black", width=2)
c.create_polyline([(20, 180), (80, 220), (140, 180), (200, 220), (260, 180)], color="purple", width=3)

# Layering: draw a light rect over a dark one, then send it to the back.
c.create_rectangle(300, 150, 460, 300, fill="lightcoral")
front = c.create_rectangle(340, 190, 440, 290, fill="lightblue")
front.to_back()

c.create_text(240, 175, "shapes + text", color="black", font_size=18, anchor="center")
print("shapes drawn")
