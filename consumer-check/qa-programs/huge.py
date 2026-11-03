from graphics import Canvas
c = Canvas(4096, 4096, title="Huge")
print("canvas is", c.width, "x", c.height)
for i in range(8):
    c.create_rectangle(i * 512, i * 512, i * 512 + 512, i * 512 + 512, fill="#%02x40%02x" % (40 + i * 25, 220 - i * 25), outline="black", width=8)
c.create_text(2048, 2048, "4096 x 4096 canvas scaled to fit", anchor="center", font_size=160, color="black")
c.get_event(timeout=20)
