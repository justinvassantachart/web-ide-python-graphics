import json
import pathlib
import struct
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'src' / 'python'))
import web_ide_transport as transport
import graphics

HEADER = struct.Struct('>BBHI')


def frame(channel, value):
    payload = json.dumps(value, separators=(',', ':')).encode()
    return HEADER.pack(0xC7, 1, channel, len(payload)) + payload


class Device:
    def __init__(self, services=None):
        self.services = services if services is not None else [
            {'channel': 7, 'capability': 'graphics', 'version': 1},
            {'channel': 2, 'capability': 'echo', 'version': 1},
            {'channel': 3, 'capability': 'counter', 'version': 1},
        ]
        self.buffer = bytearray()
        self.output = bytearray()
        self.messages = []
        self.opens = 0
        self.closes = 0
        self.zero_write = False
        self.response = None
        self.welcome = None
        self.objects = []
        self.events = []

    def open(self, path, flags):
        self.opens += 1
        return 99

    def close(self, fd):
        self.closes += 1

    def write(self, fd, data):
        if self.zero_write:
            return 0
        count = min(3, len(data))
        self.buffer.extend(data[:count])
        if len(self.buffer) >= HEADER.size:
            magic, version, channel, length = HEADER.unpack(self.buffer[:HEADER.size])
            if len(self.buffer) == HEADER.size + length:
                self.assert_frame(magic, version)
                message = json.loads(self.buffer[HEADER.size:])
                self.buffer.clear()
                self.messages.append((channel, message))
                self.reply(channel, message)
        return count

    def assert_frame(self, magic, version):
        assert magic == 0xC7 and version == 1

    def reply(self, channel, message):
        if channel == 0:
            self.output.extend(frame(0, self.welcome or {'t': 'welcome', 'mux': 1, 'services': self.services}))
        elif type(message.get('id')) is int:
            if self.response:
                self.output.extend(self.response(channel, message))
                return
            result = {'w': 300, 'h': 200} if message['op'] == 'metrics' else {}
            if channel == 2:
                result = message.get('value')
            elif channel == 3:
                result = len(self.messages)
            elif message['op'] == 'wait_event':
                result = {'event': self.events.pop(0) if self.events else None}
            self.output.extend(frame(channel, {'id': message['id'], 'ok': True, 'result': result}))
        elif message['op'] == 'add':
            self.objects.append(message)

    def read(self, fd, count):
        count = min(count, 2, len(self.output))
        chunk = bytes(self.output[:count])
        del self.output[:count]
        return chunk


class TransportTests(unittest.TestCase):
    def setUp(self):
        transport._connection = None
        graphics._ACTIVE_CANVAS = None
        self.dev = Device()
        self.patches = [patch.object(transport.os, name, getattr(self.dev, name)) for name in ('open', 'close', 'read', 'write')]
        for item in self.patches:
            item.start()

    def tearDown(self):
        if transport._connection:
            transport._connection.close()
        for item in self.patches:
            item.stop()

    def test_two_services_share_descriptor_handshake_reader_and_ids_with_partial_io(self):
        connection = transport.get_connection()
        one = connection.service('echo')
        two = connection.service('counter')
        self.assertEqual(one.request('echo', value=0), 0)
        self.assertEqual(two.request('count'), 3)
        self.assertEqual(one.request('echo', value=False), False)
        self.assertEqual(self.dev.opens, 1)
        self.assertEqual([message['id'] for channel, message in self.dev.messages if channel], [1, 2, 3])
        self.assertIs(transport.get_connection(), connection)

    def test_graphics_negotiates_channel_and_closing_canvas_does_not_close_other_service(self):
        echo = transport.get_connection().service('echo')
        self.assertEqual(echo.request('echo', value='before'), 'before')
        self.assertEqual(self.dev.objects, [])
        canvas = graphics.Canvas()
        canvas.create_text(1, 2, 'hello')
        self.assertEqual(echo.request('echo', value='after'), 'after')
        canvas.close()
        self.assertEqual(self.dev.closes, 0)
        self.assertEqual(echo.request('echo', value='still available'), 'still available')
        graphics_channels = [ch for ch, message in self.dev.messages if message.get('op') in ('init', 'canvas', 'add', 'metrics')]
        self.assertEqual(set(graphics_channels), {7})

    def test_graphics_unbounded_wait_polls_in_bounded_requests(self):
        canvas = graphics.Canvas()
        self.dev.events = [None, {'kind': 'mouseclick', 'x': 3, 'y': 4, 'button': 0}]
        event = canvas.get_event()
        self.assertEqual((event.x, event.y), (3, 4))
        waits = [m for _, m in self.dev.messages if m.get('op') == 'wait_event']
        self.assertEqual([m['timeout_ms'] for m in waits], [60000, 60000])

    def test_preserves_safe_error_code_and_accepts_followup_request(self):
        client = transport.get_connection().service('echo')
        self.dev.response = lambda channel, message: frame(channel, {'id': message['id'], 'ok': False, 'error': {'code': 'AI_DISABLED', 'message': 'AI is disabled'}})
        with self.assertRaises(transport.TransportError) as caught:
            client.request('ask')
        self.assertEqual(caught.exception.code, 'AI_DISABLED')
        self.dev.response = None
        self.assertEqual(client.request('ask', value='ok'), 'ok')

    def test_rejects_global_overlap_and_numeric_command_ids_without_writing(self):
        connection = transport.get_connection()
        client = connection.service('echo')
        connection._busy = True
        with self.assertRaisesRegex(transport.TransportError, 'one request'):
            client.request('ask')
        connection._busy = False
        with self.assertRaisesRegex(transport.TransportError, 'command ids'):
            client.command('set', id=5)
        self.assertEqual(len(self.dev.messages), 1)

    def test_rejects_invalid_handshake_and_closes_once(self):
        for welcome in [
            {'t': 'welcome', 'mux': 2, 'services': []},
            {'t': 'welcome', 'mux': True, 'services': []},
            {'t': 'welcome', 'mux': 1, 'services': [{'channel': 0, 'capability': 'echo', 'version': 1}]},
            {'t': 'welcome', 'mux': 1, 'services': self.dev.services + [self.dev.services[0]]},
            {'t': 'welcome', 'mux': 1, 'services': {}},
        ]:
            self.dev.welcome = welcome
            with self.assertRaises(transport.TransportClosed):
                transport.Connection()
        self.assertEqual(self.dev.opens, self.dev.closes)

    def test_missing_or_wrong_service_version_does_not_close_shared_connection(self):
        connection = transport.get_connection()
        for name, version in [('missing', 1), ('echo', 2), ('echo', True)]:
            with self.assertRaises(transport.TransportError):
                connection.service(name, version)
        self.assertEqual(self.dev.closes, 0)

    def test_zero_write_and_eof_are_closed_errors(self):
        self.dev.zero_write = True
        with self.assertRaisesRegex(transport.TransportClosed, 'write progress'):
            transport.Connection()
        self.dev.zero_write = False
        client = transport.get_connection().service('echo')
        self.dev.response = lambda channel, message: b''
        with self.assertRaises(transport.TransportClosed):
            client.request('ask')
        self.assertEqual(self.dev.closes, 2)

    def test_fatal_response_validation_closes_connection(self):
        invalid = [
            lambda ch, m: frame(ch + 1, {'id': m['id'], 'ok': True}),
            lambda ch, m: frame(ch, {'id': m['id'] + 1, 'ok': True}),
            lambda ch, m: frame(ch, {'id': m['id'], 'ok': 'yes'}),
            lambda ch, m: frame(ch, []),
            lambda ch, m: HEADER.pack(0xC7, 1, ch, 262145),
            lambda ch, m: HEADER.pack(0xC7, 1, ch, 1) + b'\xff',
            lambda ch, m: frame(ch, {'id': m['id'], 'ok': False, 'error': 'invalid'}),
        ]
        for response in invalid:
            connection = transport.Connection()
            self.dev.response = response
            with self.assertRaises(transport.TransportClosed):
                connection.service('echo').request('ask')
            self.dev.response = None
        self.assertEqual(self.dev.opens, self.dev.closes)

    def test_oversize_outbound_frame_never_reaches_device(self):
        client = transport.get_connection().service('echo')
        with self.assertRaises(transport.TransportError):
            client.request('ask', value='x' * 262144)
        self.assertEqual(len(self.dev.messages), 1)

    def test_graphics_rejects_aggregate_budgets_before_writing_and_frees_deleted_points(self):
        canvas = graphics.Canvas()
        points = [(0, 0)] * 10000
        handles = [canvas.create_polyline(points) for _ in range(10)]
        writes = len(self.dev.messages)
        with self.assertRaises(graphics.GraphicsError) as caught:
            canvas.create_polyline([(1, 1)])
        self.assertEqual(caught.exception.code, 'limit_exceeded')
        self.assertEqual(len(self.dev.messages), writes)
        handles[0].delete()
        canvas.create_polyline(points)
        canvas.clear()
        labels = [canvas.create_text(0, 0, 'x' * 4096) for _ in range(256)]
        with self.assertRaises(graphics.GraphicsError):
            canvas.create_text(0, 0, 'x')
        labels[0].set_text('')
        canvas.create_text(0, 0, 'x' * 4096)

    def test_importing_neutral_transport_does_not_import_graphics(self):
        self.assertNotIn('graphics', transport.__dict__)
        self.assertEqual(self.dev.opens, 0)


if __name__ == '__main__':
    unittest.main()
