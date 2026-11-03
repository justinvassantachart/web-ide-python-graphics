"""Introductory 2D graphics for Web IDE Python programs.

This module talks to the host IDE over the Web IDE host byte device
(``/dev/debugger-sh-host``) using the python-graphics wire protocol v1. It is a
small, documented, retained-object API: create shapes and text, get back stable
handles, move/update/delete them, read mouse and keyboard input, and pace
animation with ``pause``.

Typical use::

    from graphics import Canvas

    c = Canvas(400, 300, title="Demo")
    box = c.create_rectangle(50, 50, 150, 120, fill="skyblue", outline="navy", width=2)
    c.create_text(200, 20, "Hello", color="black", font_size=16, anchor="center")
    while c.is_open():
        event = c.get_event()
        if event is None:
            continue
        if event.type == "mouseclick":
            box.move(10, 0)
        elif event.type == "keydown" and event.key == "q":
            break

The module name ``graphics`` (and ``graphics.turtle``) is reserved by the
companion; a workspace file named ``graphics.py`` is shadowed by this package.
"""

import json
import math
import os
import re
import struct

__all__ = [
    "Canvas",
    "GraphicsObject",
    "Event",
    "GraphicsError",
    "GraphicsClosed",
]

# ---- wire protocol constants (keep in lockstep with src/protocol/constants.ts)
_DEVICE_PATH = "/dev/debugger-sh-host"
_MAGIC = 0xC7
_VERSION = 1
_CHANNEL_CONTROL = 0
_CHANNEL_GRAPHICS = 1
_HEADER = struct.Struct(">BBHI")  # magic, version, channel(u16), length(u32)
_MAX_FRAME_BYTES = 262144
_U32 = 0xFFFFFFFF

# Mirrors src/model/color.ts so invalid colors raise in Python instead of being
# silently dropped by the host. Must stay a subset-or-equal of the host set.
_NAMED_COLORS = frozenset(
    """transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige
    bisque black blanchedalmond blue blueviolet brown burlywood cadetblue
    chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
    darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
    darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
    darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
    deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
    fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
    honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen
    lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray
    lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue
    lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
    magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple
    mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
    mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy
    oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
    paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue
    purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
    seagreen seashell sienna silver skyblue slateblue slategray slategrey snow
    springgreen steelblue tan teal thistle tomato turquoise violet wheat white
    whitesmoke yellow yellowgreen""".split()
)
_HEX_RE = re.compile(r"^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$", re.I)
_RGB_RE = re.compile(
    r"^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$",
    re.I,
)
_FONT_FAMILIES = frozenset(
    ["sans-serif", "serif", "monospace", "system-ui", "cursive", "fantasy"]
)
_ANCHORS = frozenset(["nw", "n", "ne", "w", "center", "e", "sw", "s", "se"])

# Client-side limits (mirror of the host; prevents silent drops).
_MAX_OBJECTS = 10000
_MAX_POINTS = 10000
_MAX_TEXT_LEN = 4096
_MAX_CANVAS_DIM = 4096
_MAX_PAUSE_MS = 60000


class GraphicsError(Exception):
    """A graphics API misuse or a host-reported error."""

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class GraphicsClosed(GraphicsError):
    """The graphics device closed (program stopped or host ended the run)."""

    def __init__(self, message="graphics device closed"):
        super().__init__(message, code="closed")


def _is_color(value):
    if not isinstance(value, str):
        return False
    text = value.strip().lower()
    if not text or len(text) > 64:
        return False
    if text in _NAMED_COLORS or _HEX_RE.match(text):
        return True
    if _RGB_RE.match(text):
        parts = text[text.index("(") + 1 : text.rindex(")")].split(",")[:3]
        return all(0 <= int(p.strip()) <= 255 for p in parts)
    return False


def _color(value, field):
    """Validates an optional color; None means 'no paint'."""
    if value is None:
        return None
    if not _is_color(value):
        raise GraphicsError("%s is not an allowed color: %r" % (field, value))
    return value


def _num(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise GraphicsError("%s must be a number" % field)
    if not math.isfinite(value):
        raise GraphicsError("%s must be finite" % field)
    return value


def _nonneg(value, field):
    """Mirrors the host's non-negative check (e.g. stroke width)."""
    n = _num(value, field)
    if n < 0:
        raise GraphicsError("%s must be >= 0" % field)
    return n


def _positive(value, field):
    """Mirrors the host's strictly-positive check (e.g. font size)."""
    n = _num(value, field)
    if n <= 0:
        raise GraphicsError("%s must be > 0" % field)
    return n


def _text_len(text):
    # Count UTF-16 code units, matching the host's JS string-length limit
    # exactly, so a client-accepted string is never dropped by the host.
    return len(text.encode("utf-16-le")) // 2


def _points(value, field):
    pts = list(value)
    if len(pts) > _MAX_POINTS:
        raise GraphicsError("%s exceeds %d points" % (field, _MAX_POINTS))
    out = []
    for i, p in enumerate(pts):
        pair = list(p)
        if len(pair) != 2:
            raise GraphicsError("%s[%d] must be (x, y)" % (field, i))
        out.append([_num(pair[0], "%s[%d].x" % (field, i)), _num(pair[1], "%s[%d].y" % (field, i))])
    return out


class _Connection:
    """Single duplex connection to the host device (one per program)."""

    def __init__(self):
        try:
            self._fd = os.open(_DEVICE_PATH, os.O_RDWR)
        except OSError as exc:
            raise GraphicsError(
                "graphics device unavailable; run this program inside a Web IDE "
                "with the python-graphics companion enabled"
            ) from exc
        self._buf = bytearray()
        self._next_id = 1
        # Multiplexer handshake, then graphics init/version negotiation.
        self._send(_CHANNEL_CONTROL, {"t": "hello", "mux": _VERSION})
        welcome = self._read_json(_CHANNEL_CONTROL)
        if welcome.get("t") != "welcome":
            raise GraphicsError("unexpected control reply: %r" % welcome.get("t"))
        services = {s.get("capability"): s for s in welcome.get("services", [])}
        gfx = services.get("graphics")
        if not gfx:
            raise GraphicsError("host does not provide a graphics service")
        if gfx.get("version") != 1:
            raise GraphicsError("unsupported graphics service version: %r" % gfx.get("version"))

    def close(self):
        try:
            os.close(self._fd)
        except OSError:
            pass

    def _write_all(self, data):
        view = memoryview(data)
        sent = 0
        while sent < len(view):
            try:
                sent += os.write(self._fd, view[sent:])
            except OSError as exc:
                raise GraphicsClosed() from exc

    def _read_exact(self, count):
        while len(self._buf) < count:
            try:
                chunk = os.read(self._fd, 65536)
            except OSError as exc:
                raise GraphicsClosed() from exc
            if not chunk:
                raise GraphicsClosed()
            self._buf.extend(chunk)
        out = bytes(self._buf[:count])
        del self._buf[:count]
        return out

    def _send(self, channel, obj):
        payload = json.dumps(obj, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(payload) > _MAX_FRAME_BYTES:
            raise GraphicsError("message too large (%d bytes)" % len(payload))
        self._write_all(_HEADER.pack(_MAGIC, _VERSION, channel, len(payload)) + payload)

    def _read_json(self, expected_channel):
        header = self._read_exact(_HEADER.size)
        magic, version, channel, length = _HEADER.unpack(header)
        if magic != _MAGIC or version != _VERSION:
            raise GraphicsClosed("protocol desync")
        if length > _MAX_FRAME_BYTES:
            raise GraphicsClosed("oversized frame")
        payload = self._read_exact(length) if length else b""
        message = json.loads(payload.decode("utf-8")) if payload else {}
        if channel != expected_channel:
            if channel == _CHANNEL_CONTROL and message.get("t") == "error":
                raise GraphicsError(message.get("message", "protocol error"), message.get("code"))
            raise GraphicsClosed("unexpected channel %d" % channel)
        return message

    def command(self, op, **fields):
        fields["op"] = op
        self._send(_CHANNEL_GRAPHICS, fields)

    def request(self, op, **fields):
        request_id = self._next_id
        self._next_id = 1 if request_id >= _U32 else request_id + 1
        fields["op"] = op
        fields["id"] = request_id
        self._send(_CHANNEL_GRAPHICS, fields)
        message = self._read_json(_CHANNEL_GRAPHICS)
        if message.get("id") != request_id:
            raise GraphicsClosed("response id mismatch")
        if message.get("ok"):
            return message.get("result") or {}
        error = message.get("error") or {}
        raise GraphicsError(error.get("message", "request failed"), error.get("code"))


class Event:
    """A mouse or keyboard event delivered by :meth:`Canvas.get_event`."""

    def __init__(self, data):
        self.type = data.get("kind")
        self.kind = self.type
        self.x = data.get("x")
        self.y = data.get("y")
        self.button = data.get("button")
        self.key = data.get("key")
        self.text = data.get("text")

    def __repr__(self):
        return "Event(%r, x=%r, y=%r, key=%r)" % (self.type, self.x, self.y, self.key)


class GraphicsObject:
    """A stable handle to one drawn object. Methods mutate the live scene."""

    def __init__(self, canvas, object_id):
        self._canvas = canvas
        self.id = object_id
        self._deleted = False

    def _check(self):
        if self._deleted:
            raise GraphicsError("object %r has been deleted" % self.id)

    def move(self, dx, dy):
        self._check()
        self._canvas._command("move", id=self.id, dx=_num(dx, "dx"), dy=_num(dy, "dy"))
        return self

    def move_to(self, x, y):
        self._check()
        self._canvas._command("moveto", id=self.id, x=_num(x, "x"), y=_num(y, "y"))
        return self

    def set_fill(self, color):
        return self._update(fill=_color(color, "fill"))

    def set_outline(self, color):
        return self._update(outline=_color(color, "outline"))

    def set_color(self, color):
        """Sets whichever paint is primary (fill for most shapes/text)."""
        return self._update(fill=_color(color, "color"))

    def set_width(self, width):
        return self._update(width=_nonneg(width, "width"))

    def set_opacity(self, opacity):
        return self._update(opacity=_num(opacity, "opacity"))

    def set_text(self, text):
        if not isinstance(text, str):
            raise GraphicsError("text must be a string")
        if _text_len(text) > _MAX_TEXT_LEN:
            raise GraphicsError("text exceeds %d characters" % _MAX_TEXT_LEN)
        return self._update(text=text)

    def set_font_size(self, size):
        return self._update(font_size=_positive(size, "font_size"))

    def _update(self, **props):
        self._check()
        self._canvas._command("update", id=self.id, props=props)
        return self

    def set_visible(self, visible):
        self._check()
        self._canvas._command("visible", id=self.id, on=bool(visible))
        return self

    def hide(self):
        return self.set_visible(False)

    def show(self):
        return self.set_visible(True)

    def to_front(self):
        return self._order("front")

    def to_back(self):
        return self._order("back")

    def forward(self):
        return self._order("forward")

    def backward(self):
        return self._order("backward")

    def _order(self, mode):
        self._check()
        self._canvas._command("order", id=self.id, mode=mode)
        return self

    def get_bounds(self):
        """Returns the object's measured bounds as a dict {x, y, w, h}."""
        self._check()
        return self._canvas._bounds(self.id)

    def delete(self):
        if self._deleted:
            return
        self._deleted = True
        self._canvas._delete(self.id)


class Canvas:
    """A drawing surface. Create one per program."""

    def __init__(self, width=300, height=200, title="", background="white"):
        global _ACTIVE_CANVAS
        if _ACTIVE_CANVAS is not None:
            raise GraphicsError("only one Canvas is supported per program")
        self._conn = _Connection()
        self._conn.request("init", client="python-graphics", version=1)
        self._next = 1
        self._live = set()
        self._closed = False
        w = int(min(max(_num(width, "width"), 1), _MAX_CANVAS_DIM))
        h = int(min(max(_num(height, "height"), 1), _MAX_CANVAS_DIM))
        if not isinstance(title, str):
            raise GraphicsError("title must be a string")
        self._conn.command("canvas", w=w, h=h, title=title, background=_color(background, "background") or "white")
        metrics = self._conn.request("metrics")
        self.width = metrics.get("w", w)
        self.height = metrics.get("h", h)
        _ACTIVE_CANVAS = self

    # ---- drawing ----------------------------------------------------------

    def create_line(self, x1, y1, x2, y2, color="black", width=1):
        return self._add(
            "line", x1=_num(x1, "x1"), y1=_num(y1, "y1"), x2=_num(x2, "x2"), y2=_num(y2, "y2"),
            outline=_color(color, "color"), width=_nonneg(width, "width"),
        )

    def create_polyline(self, points, color="black", width=1, fill=None):
        return self._add(
            "polyline", points=_points(points, "points"),
            outline=_color(color, "color"), width=_nonneg(width, "width"), fill=_color(fill, "fill"),
        )

    def create_rectangle(self, x1, y1, x2, y2, fill=None, outline="black", width=1):
        x, y, w, h = _corners_to_box(x1, y1, x2, y2)
        return self._add(
            "rect", x=x, y=y, w=w, h=h,
            fill=_color(fill, "fill"), outline=_color(outline, "outline"), width=_nonneg(width, "width"),
        )

    def create_oval(self, x1, y1, x2, y2, fill=None, outline="black", width=1):
        x, y, w, h = _corners_to_box(x1, y1, x2, y2)
        return self._add(
            "oval", x=x, y=y, w=w, h=h,
            fill=_color(fill, "fill"), outline=_color(outline, "outline"), width=_nonneg(width, "width"),
        )

    def create_circle(self, cx, cy, radius, fill=None, outline="black", width=1):
        r = _num(radius, "radius")
        return self.create_oval(cx - r, cy - r, cx + r, cy + r, fill=fill, outline=outline, width=width)

    def create_polygon(self, points, fill=None, outline="black", width=1):
        return self._add(
            "polygon", points=_points(points, "points"),
            fill=_color(fill, "fill"), outline=_color(outline, "outline"), width=_nonneg(width, "width"),
        )

    def create_text(self, x, y, text, color="black", font_size=16, anchor="nw", font_family="sans-serif"):
        if not isinstance(text, str):
            raise GraphicsError("text must be a string")
        if _text_len(text) > _MAX_TEXT_LEN:
            raise GraphicsError("text exceeds %d characters" % _MAX_TEXT_LEN)
        if anchor not in _ANCHORS:
            raise GraphicsError("anchor must be one of %s" % ", ".join(sorted(_ANCHORS)))
        if font_family not in _FONT_FAMILIES:
            raise GraphicsError("font_family must be one of %s" % ", ".join(sorted(_FONT_FAMILIES)))
        return self._add(
            "text", x=_num(x, "x"), y=_num(y, "y"), text=text,
            fill=_color(color, "color"), font_size=_positive(font_size, "font_size"),
            anchor=anchor, font_family=font_family,
        )

    def _add(self, shape, **fields):
        self._ensure_open()
        if len(self._live) >= _MAX_OBJECTS:
            raise GraphicsError("too many objects (max %d)" % _MAX_OBJECTS, code="too_many_objects")
        object_id = "g%d" % self._next
        self._next += 1
        self._conn.command("add", id=object_id, shape=shape, **fields)
        self._live.add(object_id)
        return GraphicsObject(self, object_id)

    # ---- scene control ----------------------------------------------------

    def clear(self):
        self._ensure_open()
        self._live.clear()
        self._conn.command("clear")

    def move(self, obj, dx, dy):
        _as_object(self, obj).move(dx, dy)

    def delete(self, obj):
        _as_object(self, obj).delete()

    def _delete(self, object_id):
        self._live.discard(object_id)
        self._conn.command("delete", id=object_id)

    def _command(self, op, id, **fields):
        self._ensure_open()
        if id not in self._live:
            raise GraphicsError("unknown object %r" % id, code="unknown_object")
        self._conn.command(op, id=id, **fields)

    def _bounds(self, object_id):
        self._ensure_open()
        if object_id not in self._live:
            raise GraphicsError("unknown object %r" % object_id, code="unknown_object")
        try:
            return self._conn.request("bounds", target=object_id)
        except GraphicsClosed:
            self._closed = True
            raise

    # ---- input / timing ---------------------------------------------------

    def get_event(self, timeout=None):
        """Blocks for the next input event, or returns None on timeout/close."""
        self._ensure_open()
        if timeout is not None and (isinstance(timeout, bool) or not isinstance(timeout, (int, float))):
            raise GraphicsError("timeout must be a number of seconds or None")
        try:
            kwargs = {} if timeout is None else {"timeout_ms": int(min(max(timeout, 0), _MAX_PAUSE_MS / 1000) * 1000)}
            result = self._conn.request("wait_event", **kwargs)
        except GraphicsClosed:
            self._closed = True
            return None
        data = result.get("event")
        return Event(data) if data else None

    def poll_event(self):
        """Returns the next queued event without blocking, or None."""
        self._ensure_open()
        try:
            result = self._conn.request("poll_event")
        except GraphicsClosed:
            self._closed = True
            return None
        data = result.get("event")
        return Event(data) if data else None

    def get_mouse(self):
        """Blocks until the next mouse click; returns (x, y) or None if closed."""
        while self.is_open():
            event = self.get_event()
            if event is None:
                continue
            if event.type == "mouseclick":
                return (event.x, event.y)
        return None

    def wait_for_click(self):
        return self.get_mouse()

    def pause(self, milliseconds):
        """Host-timed, cancellable pause used to pace animation."""
        self._ensure_open()
        try:
            self._conn.request("pause", ms=int(min(max(_num(milliseconds, "milliseconds"), 0), _MAX_PAUSE_MS)))
        except GraphicsClosed:
            self._closed = True

    def is_open(self):
        return not self._closed

    def _ensure_open(self):
        if self._closed:
            raise GraphicsClosed()

    def close(self):
        global _ACTIVE_CANVAS
        self._closed = True
        self._conn.close()
        if _ACTIVE_CANVAS is self:
            _ACTIVE_CANVAS = None


_ACTIVE_CANVAS = None


def _corners_to_box(x1, y1, x2, y2):
    ax, ay = _num(x1, "x1"), _num(y1, "y1")
    bx, by = _num(x2, "x2"), _num(y2, "y2")
    return min(ax, bx), min(ay, by), abs(bx - ax), abs(by - ay)


def _as_object(canvas, obj):
    if isinstance(obj, GraphicsObject):
        return obj
    if isinstance(obj, str):
        if not 1 <= len(obj) <= 128:
            raise GraphicsError("object id must be 1..128 characters")
        return GraphicsObject(canvas, obj)
    raise GraphicsError("expected a graphics object or id")
