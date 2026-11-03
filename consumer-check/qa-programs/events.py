from graphics import Canvas
c = Canvas(400, 300, title="Events")
c.create_text(200, 20, "click / press keys; q quits", color="gray", anchor="center")
while c.is_open():
    e = c.get_event(timeout=25)
    if e is None:
        print("timeout"); break
    if e.type == "mouseclick":
        print("click", round(e.x), round(e.y))
        c.create_circle(e.x, e.y, 8, fill="crimson")
    elif e.type == "keydown":
        print("key", e.key)
        if e.key == "q": break
print("done")
