from graphics import Canvas
c = Canvas(120, 80, title="Tiny", background="#fff8e1")
c.create_oval(10, 10, 70, 70, fill="tomato")
c.create_text(60, 75, "120x80", anchor="s", font_size=11)
c.get_event(timeout=20)
