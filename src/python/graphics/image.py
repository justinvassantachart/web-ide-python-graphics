"""Compact local pixels with bounded browser image codecs (no Pillow required).

Image preserves RGBA. SimpleImage supplies Stanford's opaque RGB teaching API.
Coordinates are top-left, iteration is row-major, resize uses nearest-neighbor.
Image.show() publishes a snapshot; later edits appear only after show()/refresh().
"""
import base64
import math
import os
from web_ide_transport import get_connection, TransportError

_MAX_PIXELS = 4000000
_MAX_DIMENSION = 4096
_MAX_GUEST_BYTES = 48 * 1024 * 1024
_MAX_ENCODED_BYTES = 8 * 1024 * 1024
_CHUNK = 32768
_live_bytes = 0
_next_identity = 0
_service = None
_pending_releases = []


class ImageError(ValueError):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


def _integer(value, name):
    if type(value) is not int:
        raise TypeError('%s must be an integer' % name)
    return value


def _channel(value):
    if type(value) is int:
        return 0 if value < 0 else 255 if value > 255 else value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError('pixel channels must be finite numbers')
    if not math.isfinite(value):
        raise ValueError('pixel channels must be finite numbers')
    return max(0, min(255, int(value)))


def _dimensions(width, height):
    _integer(width, 'width')
    _integer(height, 'height')
    if width < 1 or height < 1 or width > _MAX_DIMENSION or height > _MAX_DIMENSION or width * height > _MAX_PIXELS:
        raise ImageError('image dimensions exceed the supported limit', 'IMAGE_TOO_LARGE')
    return width * height * 4


def _request(op, **fields):
    global _service
    if _service is None:
        _service = get_connection().service('images', version=1)
    try:
        # GC never performs I/O. Drain deferred owner drops on the next image RPC.
        while _pending_releases:
            resource = _pending_releases.pop()
            try:
                _service.request('resource.release', resourceId=resource['resourceId'], version=resource['version'])
            except TransportError as exc:
                if exc.code != 'STALE_RESOURCE':
                    _pending_releases.append(resource)
                    raise
        return _service.request(op, **fields)
    except TransportError as exc:
        raise ImageError(str(exc), exc.code) from exc


def _path(path):
    if not isinstance(path, str) or not path or len(path) > 1024 or '\0' in path:
        raise ImageError('image path must be a nonempty filename', 'INVALID_PATH')
    return os.path.normpath(path)


def _write_transfer(transfer, data):
    for offset in range(0, len(data), _CHUNK):
        _request('transfer.write', transferId=transfer, offset=offset,
                 base64=base64.b64encode(data[offset:offset + _CHUNK]).decode('ascii'))


def _read_resource(resource, length):
    result = bytearray()
    for offset in range(0, length, _CHUNK):
        chunk = _request('resource.read', resourceId=resource['resourceId'], version=resource['version'],
                         offset=offset, length=min(_CHUNK, length - offset))
        data = base64.b64decode(chunk['base64'])
        if len(data) != min(_CHUNK, length - offset):
            raise ImageError('incomplete image response', 'INVALID_TRANSFER')
        result.extend(data)
    return result


class Pixel:
    """Coordinate view into its image. Writes immediately change local pixels."""
    __slots__ = ('_image', '_x', '_y')

    def __init__(self, image, x, y):
        image._offset(x, y)
        self._image, self._x, self._y = image, x, y

    @property
    def x(self):
        return self._x

    @property
    def y(self):
        return self._y

    def _get(self, channel):
        return self._image._data[self._image._offset(self._x, self._y) + channel]

    def _set(self, channel, value):
        index = self._image._offset(self._x, self._y) + channel
        self._image._data[index] = _channel(value)
        self._image._dirty = True

    red = property(lambda self: self._get(0), lambda self, v: self._set(0, v))
    green = property(lambda self: self._get(1), lambda self, v: self._set(1, v))
    blue = property(lambda self: self._get(2), lambda self, v: self._set(2, v))
    alpha = property(lambda self: self._get(3), lambda self, v: self._set(3, 255 if self._image._opaque else v))

    def __repr__(self):
        return 'Pixel(%d, %d, red=%d, green=%d, blue=%d)' % (self.x, self.y, self.red, self.green, self.blue)


class Image:
    """An independently owned, compact RGBA image loaded from a real guest file."""
    _opaque = False

    def __init__(self, filename):
        self._allocation = 0
        self._resource = None
        self._dirty = True
        path = _path(filename)
        with open(path, 'rb') as stream:
            data = stream.read(_MAX_ENCODED_BYTES + 1)
        if len(data) > _MAX_ENCODED_BYTES:
            raise ImageError('encoded image exceeds 8 MiB', 'IMAGE_TOO_LARGE')
        transfer = _request('encoded.begin', length=len(data))['transferId']
        try:
            _write_transfer(transfer, data)
            resource = _request('encoded.decode', transferId=transfer)
            size = _dimensions(resource['width'], resource['height'])
            try:
                self._reserve(size)
                pixels = _read_resource(resource, size)
            finally:
                _request('resource.release', resourceId=resource['resourceId'], version=resource['version'])
            if self._opaque:
                pixels[3::4] = bytes([255]) * (size // 4)
            self._initialize(resource['width'], resource['height'], pixels, reserved=True)
        except Exception:
            try:
                _request('transfer.release', transferId=transfer)
            except Exception:
                pass
            self._release_allocation()
            raise
        self.filename = path

    def _reserve(self, size):
        global _live_bytes
        delta = size - self._allocation
        if _live_bytes + delta > _MAX_GUEST_BYTES:
            raise ImageError('live image pixels exceed the 48 MiB guest budget; release unused images', 'IMAGE_BUDGET_EXCEEDED')
        _live_bytes += delta
        self._allocation = size

    def _release_allocation(self):
        global _live_bytes
        _live_bytes -= getattr(self, '_allocation', 0)
        self._allocation = 0

    def __del__(self):
        self._release_allocation()
        # Never open the device or wait for an RPC from a garbage collector.
        pending = globals().get('_pending_releases')
        if pending is not None:
            resource = getattr(self, '_resource', None)
            if resource is not None: pending.append(resource)
            pending.extend(getattr(self, '_previous', ()))

    def __repr__(self):
        return '%s(%d x %d, filename=%r)' % (type(self).__name__, self._width, self._height, (self.filename[:200] if self.filename else None))

    def _initialize(self, width, height, data, reserved=False):
        global _next_identity
        self._allocation = getattr(self, '_allocation', 0)
        if not reserved:
            self._reserve(_dimensions(width, height))
        self._width, self._height = width, height
        self._data = data
        self._resource = None
        self._dirty = True
        self._previous = []
        self.filename = None
        _next_identity += 1
        self._identity = 'python-image-%d' % _next_identity

    @classmethod
    def blank(cls, width, height, color='white'):
        size = _dimensions(width, height)
        rgba = _rgba(color, cls._opaque)
        image = cls.__new__(cls)
        image._allocation = 0
        image._reserve(size)
        try:
            image._initialize(width, height, bytearray(rgba) * (width * height), reserved=True)
        except Exception:
            image._release_allocation()
            raise
        return image

    @classmethod
    def file(cls, filename):
        return cls(filename)

    @property
    def width(self):
        return self._width

    @property
    def height(self):
        return self._height

    def _offset(self, x, y):
        if type(x) is not int or type(y) is not int:
            raise TypeError('pixel coordinates must be integers')
        if x < 0 or y < 0 or x >= self._width or y >= self._height:
            raise IndexError('pixel (%d, %d) is outside image %d x %d' % (x, y, self.width, self.height))
        return (y * self._width + x) * 4

    def in_bounds(self, x, y):
        return type(x) is int and type(y) is int and 0 <= x < self.width and 0 <= y < self.height

    def get_pixel(self, x, y):
        return Pixel(self, x, y)

    def set_pixel(self, x, y, pixel):
        if not isinstance(pixel, Pixel):
            raise TypeError('set_pixel expects a Pixel')
        self.set_rgba(x, y, pixel.red, pixel.green, pixel.blue, pixel.alpha)

    def get_pix(self, x, y):
        # Hot Ghost-style tuple path: avoid a temporary bytearray slice and an
        # extra Python method dispatch for every pixel in every input image.
        if type(x) is not int or type(y) is not int:
            raise TypeError('pixel coordinates must be integers')
        if x < 0 or y < 0 or x >= self._width or y >= self._height:
            raise IndexError('pixel coordinate outside image')
        offset = (y * self._width + x) * 4
        data = self._data
        return data[offset], data[offset + 1], data[offset + 2]

    def set_pix(self, x, y, rgb):
        if not isinstance(rgb, (tuple, list)) or len(rgb) != 3:
            raise TypeError('set_pix expects three RGB channels')
        self.set_rgb(x, y, *rgb)

    _get_pix_ = get_pix
    _set_pix_ = set_pix

    def set_rgb(self, x, y, red, green, blue):
        offset = self._offset(x, y)
        # The usual teaching loop writes in-range integers. Keep that path local
        # and allocation-free; uncommon numeric inputs use identical validation.
        if not (type(red) is int and 0 <= red <= 255): red = _channel(red)
        if not (type(green) is int and 0 <= green <= 255): green = _channel(green)
        if not (type(blue) is int and 0 <= blue <= 255): blue = _channel(blue)
        data = self._data
        data[offset] = red
        data[offset + 1] = green
        data[offset + 2] = blue
        data[offset + 3] = 255
        self._dirty = True

    def set_rgb_data(self, data):
        """Replace pixels from packed RGB bytes, row-major (Grid rendering helper)."""
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError('packed RGB data must be bytes-like')
        if len(data) != self._width * self._height * 3:
            raise ValueError('packed RGB data size must equal width * height * 3')
        # Native stride operations avoid thousands of per-pixel Python calls.
        self._data[0::4] = data[0::3]
        self._data[1::4] = data[1::3]
        self._data[2::4] = data[2::3]
        self._data[3::4] = bytes([255]) * (self._width * self._height)
        self._dirty = True
        return self

    def set_rgba(self, x, y, red, green, blue, alpha):
        offset = self._offset(x, y)
        values = bytes((_channel(red), _channel(green), _channel(blue), 255 if self._opaque else _channel(alpha)))
        self._data[offset:offset + 4] = values
        self._dirty = True

    def __iter__(self):
        # Independent generator, no shared image-level cursor or pixel cache.
        for y in range(self.height):
            for x in range(self.width):
                yield Pixel(self, x, y)

    def copy(self):
        image = type(self).__new__(type(self))
        image._allocation = 0
        image._reserve(len(self._data))
        image._initialize(self.width, self.height, bytearray(self._data), reserved=True)
        return image

    def crop(self, left, top, right, bottom):
        for value, name in ((left, 'left'), (top, 'top'), (right, 'right'), (bottom, 'bottom')):
            _integer(value, name)
        if not (0 <= left < right <= self.width and 0 <= top < bottom <= self.height):
            raise ValueError('crop rectangle must be nonempty and inside the image')
        result = type(self).blank(right - left, bottom - top)
        stride = result.width * 4
        for y in range(result.height):
            offset = ((y + top) * self.width + left) * 4
            result._data[y * stride:(y + 1) * stride] = self._data[offset:offset + stride]
        return result

    def resized(self, width, height):
        result = type(self).blank(width, height)
        for y in range(height):
            sy = y * self.height // height
            for x in range(width):
                src = (sy * self.width + x * self.width // width) * 4
                dst = (y * width + x) * 4
                result._data[dst:dst + 4] = self._data[src:src + 4]
        return result

    def make_as_big_as(self, other):
        if not isinstance(other, Image):
            raise TypeError('make_as_big_as expects an image')
        resized = self.resized(other.width, other.height)
        self._release_allocation()
        self._allocation, resized._allocation = resized._allocation, 0
        self._width, self._height, self._data = resized.width, resized.height, resized._data
        self._dirty = True
        return self

    def _upload(self):
        if not self._dirty and self._resource is not None:
            return self._resource
        fields = {'width': self.width, 'height': self.height}
        if self._resource is not None:
            fields['resourceId'] = self._resource['resourceId']
        transfer = _request('rgba.begin', **fields)['transferId']
        try:
            _write_transfer(transfer, self._data)
            previous = self._resource
            self._resource = _request('rgba.commit', transferId=transfer)
            if previous is not None:
                self._previous.append(previous)
            self._dirty = False
            self._release_previous()
        except Exception:
            try:
                _request('transfer.release', transferId=transfer)
            except Exception:
                pass
            raise
        return self._resource

    def show(self, title=None):
        resource = self._upload()
        _request('presentation.show', resourceId=resource['resourceId'], version=resource['version'],
                 presentationId=self._identity, title=title or self.filename or 'Image')
        self._release_previous()
        return self

    def _release_previous(self):
        while self._previous:
            resource = self._previous[-1]
            _request("resource.release", resourceId=resource["resourceId"], version=resource["version"])
            self._previous.pop()

    refresh = show

    def save(self, filename):
        path = _path(filename)
        extension = os.path.splitext(path)[1].lower()
        mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}.get(extension)
        if mime is None:
            raise ImageError('save filename must end in .png, .jpg, or .jpeg', 'UNSUPPORTED_FORMAT')
        resource = self._upload()
        encoded = _request('resource.encode', resourceId=resource['resourceId'], version=resource['version'], mediaType=mime)
        transfer = encoded['transferId']
        global _next_identity
        _next_identity += 1
        transaction = 'python-save-%d' % _next_identity
        try:
            registry_path = '/workspace/' + os.path.abspath(path).lstrip('/')
            _request('output.prepare', transactionId=transaction, path=registry_path, transferId=transfer)
            try:
                with open(path, 'wb') as stream:
                    for offset in range(0, encoded['byteLength'], _CHUNK):
                        chunk = _request('transfer.read', transferId=transfer, offset=offset, length=min(_CHUNK, encoded['byteLength'] - offset))
                        data = base64.b64decode(chunk['base64'])
                        if len(data) != min(_CHUNK, encoded['byteLength'] - offset):
                            raise ImageError('incomplete encoded output', 'INVALID_TRANSFER')
                        stream.write(data)
            except Exception:
                _request('output.abort', transactionId=transaction)
                raise
            # Retry the same idempotent receipt, never rewrite an already-saved file.
            for attempt in range(2):
                try:
                    _request('output.commit', transactionId=transaction)
                    break
                except ImageError as exc:
                    if attempt:
                        raise ImageError('The guest file was saved, but its downloadable output could not be published: ' + str(exc), exc.code) from exc
        finally:
            try:
                _request('transfer.release', transferId=transfer)
            except ImageError:
                pass  # Disconnect/reset releases the run-owned transfer.

        return self

    def close(self):
        self._release_previous()
        if self._resource is not None:
            _request('resource.release', resourceId=self._resource['resourceId'], version=self._resource['version'])
            self._resource = None
            self._dirty = True


class SimpleImage(Image):
    """Stanford teaching API: opaque RGB, white blank default, local pixel loops."""
    _opaque = True


def _rgba(color, opaque):
    named = {'white': (255, 255, 255), 'black': (0, 0, 0), 'red': (255, 0, 0),
             'green': (0, 128, 0), 'blue': (0, 0, 255), 'yellow': (255, 255, 0),
             'cyan': (0, 255, 255), 'magenta': (255, 0, 255), 'transparent': (0, 0, 0, 0)}
    if isinstance(color, str):
        color = named.get(color.lower())
    if not isinstance(color, (tuple, list)) or len(color) not in (3, 4):
        raise ValueError('blank color must be a named color or RGB/RGBA tuple')
    values = [_channel(value) for value in color]
    if len(values) == 3:
        values.append(255)
    if opaque:
        values[3] = 255
    return values
