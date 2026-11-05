"""Neutral response-only JSON transport for Web IDE's public host byte device.

``get_connection().service(capability, version=1)`` binds a client to an
advertised channel. All clients share one descriptor, handshake, reader and
monotonic request-id sequence for the entire run. A request blocks for its one
correlated response. Commands never receive responses; there is no host push.
The host enforces response deadlines and stops the runtime on fatal framing.
This module imports no graphics, AI credentials, provider code, or policy.
"""
import json
import os
import struct

__all__ = ["get_connection", "Connection", "ServiceClient", "TransportError", "TransportClosed"]
_DEVICE_PATH = "/dev/debugger-sh-host"
_MAGIC = 0xC7
_VERSION = 1
_HEADER = struct.Struct(">BBHI")
_MAX_FRAME_BYTES = 262144
_MAX_REQUEST_ID = 0xFFFFFFFF


class TransportError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class TransportClosed(TransportError):
    def __init__(self, message="host connection closed"):
        super().__init__(message, code="closed")


class Connection:
    """A single program's device owner. Hosts normally use get_connection()."""
    def __init__(self):
        self._fd = None
        self._closed = False
        self._busy = False
        self._next_id = 1
        self._services = {}
        try:
            self._fd = os.open(_DEVICE_PATH, os.O_RDWR)
        except OSError as exc:
            self._closed = True
            raise TransportError("host device unavailable; run inside an enabled Web IDE", "unavailable") from exc
        try:
            self._send(0, {"t": "hello", "mux": _VERSION})
            welcome = self._read_json(0)
            if welcome.get("t") != "welcome" or type(welcome.get("mux")) is not int or welcome.get("mux") != _VERSION:
                raise TransportClosed("unsupported transport handshake")
            services = welcome.get("services")
            if not isinstance(services, list) or len(services) > 65535:
                raise TransportClosed("invalid service advertisement")
            channels = set()
            for item in services:
                if not isinstance(item, dict):
                    raise TransportClosed("invalid service advertisement")
                channel, capability, version = item.get("channel"), item.get("capability"), item.get("version")
                if (type(channel) is not int or not 1 <= channel <= 65535
                        or type(version) is not int or not 1 <= version <= 9007199254740991
                        or not isinstance(capability, str) or not 1 <= len(capability) <= 128
                        or not capability[0].isascii() or not capability[0].isalnum()
                        or any(not c.isascii() or not (c.isalnum() or c in "._-") for c in capability)
                        or channel in channels or capability in self._services):
                    raise TransportClosed("invalid or duplicate service advertisement")
                channels.add(channel)
                self._services[capability] = (channel, version)
        except BaseException:
            self.close()
            raise

    def service(self, capability, version=1):
        self._ensure_open()
        advertised = self._services.get(capability)
        if advertised is None:
            raise TransportError("host does not provide service %r" % capability, "unavailable")
        if advertised[1] != version or type(version) is not int:
            raise TransportError("unsupported service version for %s" % capability, "unsupported")
        return ServiceClient(self, advertised[0])

    def close(self):
        if self._closed:
            return
        self._closed = True
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None

    def _ensure_open(self):
        if self._closed:
            raise TransportClosed()

    def _write_all(self, data):
        view = memoryview(data)
        sent = 0
        while sent < len(view):
            try:
                count = os.write(self._fd, view[sent:])
            except InterruptedError:
                continue
            except OSError as exc:
                self.close()
                raise TransportClosed() from exc
            if count <= 0 or count > len(view) - sent:
                self.close()
                raise TransportClosed("host device made no write progress")
            sent += count

    def _read_exact(self, count):
        # Never read ahead into another response. Bound every allocation by the
        # validated frame size, even when the device delivers partial chunks.
        buffer = bytearray()
        while len(buffer) < count:
            try:
                chunk = os.read(self._fd, min(count - len(buffer), 65536))
            except InterruptedError:
                continue
            except OSError as exc:
                self.close()
                raise TransportClosed() from exc
            if not chunk:
                self.close()
                raise TransportClosed()
            buffer.extend(chunk)
        return bytes(buffer)

    def _send(self, channel, message):
        self._ensure_open()
        try:
            payload = json.dumps(message, allow_nan=False, separators=(",", ":")).encode("utf-8")
        except (ValueError, TypeError, UnicodeError) as exc:
            raise TransportError("request is not valid JSON", "bad_request") from exc
        if len(payload) > _MAX_FRAME_BYTES:
            raise TransportError("message exceeds frame limit", "limit_exceeded")
        self._write_all(_HEADER.pack(_MAGIC, _VERSION, channel, len(payload)) + payload)

    def _read_json(self, expected_channel):
        try:
            magic, version, channel, length = _HEADER.unpack(self._read_exact(_HEADER.size))
            if magic != _MAGIC or version != _VERSION:
                raise TransportClosed("protocol desync")
            if length > _MAX_FRAME_BYTES:
                raise TransportClosed("oversized frame")
            message = json.loads(self._read_exact(length).decode("utf-8"), parse_constant=_invalid_constant)
            if not isinstance(message, dict):
                raise TransportClosed("response must be a JSON object")
            if channel == 0 and message.get("t") == "error":
                raise TransportError(message.get("message", "protocol error"), message.get("code"))
            if channel != expected_channel:
                raise TransportClosed("unexpected response channel")
            return message
        except (ValueError, UnicodeError) as exc:
            self.close()
            raise TransportClosed("invalid JSON response") from exc
        except TransportClosed:
            self.close()
            raise

    def _exchange(self, channel, op, fields, expect_reply):
        self._ensure_open()
        if self._busy:
            raise TransportError("one request may be outstanding across all services", "busy")
        if not isinstance(op, str) or not op:
            raise TransportError("op must be a nonempty string", "bad_request")
        self._busy = True
        try:
            message = dict(fields)
            message["op"] = op
            if not expect_reply:
                if "id" in message and not isinstance(message["id"], str):
                    raise TransportError("command ids must be strings", "bad_request")
                self._send(channel, message)
                return None
            if self._next_id > _MAX_REQUEST_ID:
                self.close()
                raise TransportClosed("request id space exhausted")
            request_id = self._next_id
            self._next_id += 1
            message["id"] = request_id
            self._send(channel, message)
            reply = self._read_json(channel)
            if type(reply.get("id")) is not int or reply["id"] != request_id or type(reply.get("ok")) is not bool:
                self.close()
                raise TransportClosed("response correlation mismatch")
            if reply["ok"]:
                return reply.get("result")
            error = reply.get("error")
            if not isinstance(error, dict) or not isinstance(error.get("message"), str) or not isinstance(error.get("code"), str):
                self.close()
                raise TransportClosed("invalid error response")
            raise TransportError(error["message"], error["code"])
        finally:
            self._busy = False


def _invalid_constant(value):
    raise ValueError("invalid JSON constant %s" % value)


class ServiceClient:
    """Channel-bound facade. Closing it leaves other services usable."""
    def __init__(self, connection, channel):
        self._connection = connection
        self._channel = channel
        self._closed = False

    def request(self, op, **fields):
        if self._closed:
            raise TransportClosed("service client closed")
        return self._connection._exchange(self._channel, op, fields, True)

    def command(self, op, **fields):
        if self._closed:
            raise TransportClosed("service client closed")
        return self._connection._exchange(self._channel, op, fields, False)

    def close(self):
        self._closed = True


_connection = None


def get_connection():
    """Return the run's lazy singleton; importing a helper never opens a device."""
    global _connection
    if _connection is None:
        _connection = Connection()
    return _connection
