"""Graphics and an independent service share one public connection."""
from web_ide_transport import get_connection
from graphics import Canvas

second = get_connection().service("echo", version=1)
print("BEFORE", second.request("echo", value="before graphics"))
c = Canvas(320, 180, title="Shared transport")
c.create_text(15, 20, "Both services share one device", font_size=16)
print("AFTER", second.request("echo", value="after graphics"))
c.pause(100)
c.close()
print("CLOSED", second.request("echo", value="after Canvas.close"))
