from graphics import Canvas, GraphicsError
c = Canvas(300, 200, title="Errors")
c.create_rectangle(20, 20, 120, 120, fill="skyblue")
try:
    c.create_rectangle(0, 0, 10, 10, fill="url(javascript:alert(1))")
except GraphicsError as e:
    print("rejected:", e)
try:
    c.create_text(10, 10, "x", font_size=0)
except GraphicsError as e:
    print("rejected:", e)
try:
    c.create_line(0, 0, 1, 1, width=-2)
except GraphicsError as e:
    print("rejected:", e)
print("about to crash")
raise ValueError("boom after drawing")
