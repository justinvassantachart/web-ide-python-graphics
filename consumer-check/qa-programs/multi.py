from graphics import Canvas, GraphicsError
c = Canvas(300, 200, title="Multi")
c.create_oval(50, 50, 150, 150, fill="gold")
# Talk to an independent host service on channel 2 over the SAME device.
try:
    c._conn._send(2, {"id": 7, "value": "ping"})
    reply = c._conn._read_json(2)
    print("clock reply:", reply)
    now = reply.get("result", {}).get("now")
    c.create_text(150, 180, "clock says %s" % now, anchor="center")
except GraphicsError as e:
    print("second service unavailable:", e)
    c.create_text(150, 180, "no second service", anchor="center", color="crimson")
# Graphics still works after either outcome (channel errors are recoverable).
c.create_rectangle(200, 40, 280, 120, fill="skyblue")
print("done")
