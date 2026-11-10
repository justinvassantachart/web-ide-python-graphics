import gc
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/python'))
from graphics.image import Image, SimpleImage, ImageError
import graphics.image as images


class PixelContractTests(unittest.TestCase):
    def setUp(self):
        gc.collect()
        images._pending_releases.clear()

    def tearDown(self):
        gc.collect()
        images._pending_releases.clear()

    def test_channels_live_views_and_copies(self):
        image = SimpleImage.blank(3, 2)
        self.assertEqual(image.get_pix(0, 0), (255, 255, 255))
        p = image.get_pixel(1, 0)
        same = image.get_pixel(1, 0)
        p.red, p.green, p.blue = 3.9, -2, 999
        self.assertEqual((same.red, same.green, same.blue), (3, 0, 255))
        result = SimpleImage.blank(3, 2, 'black')
        result.set_pixel(2, 1, p)
        p.red = 100
        self.assertEqual(result.get_pix(2, 1), (3, 0, 255))
        self.assertEqual(image.get_pix(1, 0), (100, 0, 255))
        self.assertEqual([(p.x, p.y) for p in image], [(0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1)])
        self.assertEqual(len([(a.x, b.y) for a in image for b in image]), 36)

    def test_coordinates_channels_and_sizes(self):
        image = Image.blank(2, 3, (1, 2, 3, 4))
        self.assertEqual(image.get_pixel(0, 0).alpha, 4)
        for coordinate in [(-1, 0), (2, 0), (0, 3)]:
            with self.assertRaises(IndexError): image.get_pixel(*coordinate)
        for value in [True, 0.1, '0']:
            with self.assertRaises(TypeError): image.get_pixel(value, 0)
        for value in [True, '2', None]:
            with self.assertRaises(TypeError): image.get_pixel(0, 0).red = value
        for value in [float('nan'), float('inf')]:
            with self.assertRaises(ValueError): image.get_pixel(0, 0).red = value
        for dims in [(0, 1), (4097, 1), (4096, 4096)]:
            with self.assertRaises(ImageError): Image.blank(*dims)
        with self.assertRaises(AttributeError): image.width = 12

    def test_packed_rgb_replacement_is_owned_and_bounded(self):
        image = Image.blank(2, 1)
        data = bytearray([1, 2, 3, 4, 5, 6])
        self.assertIs(image.set_rgb_data(data), image)
        data[0] = 255
        self.assertEqual(image.get_pix(0, 0), (1, 2, 3))
        self.assertEqual(image.get_pixel(1, 0).alpha, 255)
        with self.assertRaises(ValueError): image.set_rgb_data(b'wrong')
        with self.assertRaises(TypeError): image.set_rgb_data([1] * 6)

    def test_copy_crop_resize_and_retained_pixel(self):
        image = Image.blank(3, 2)
        image.set_rgb(2, 1, 12, 34, 56)
        copy = image.copy()
        image.set_rgb(2, 1, 0, 0, 0)
        self.assertEqual(copy.get_pix(2, 1), (12, 34, 56))
        self.assertEqual(copy.crop(1, 0, 3, 2).get_pix(1, 1), (12, 34, 56))
        self.assertEqual(copy.resized(6, 4).get_pix(5, 3), (12, 34, 56))
        retained = copy.get_pixel(2, 1)
        copy.make_as_big_as(Image.blank(1, 1))
        with self.assertRaises(IndexError): _ = retained.red

    def test_guest_budget_reclaimed(self):
        gc.collect()
        before = images._live_bytes
        image = Image.blank(3, 4)
        self.assertEqual(images._live_bytes, before + 48)
        del image
        gc.collect()
        self.assertEqual(images._live_bytes, before)

    def test_save_writes_guest_file_before_commit(self):
        calls = []
        encoded = b'example encoded bytes\x00\xff'
        def request(op, **fields):
            calls.append((op, fields))
            if op == 'rgba.begin': return {'transferId': 'rgba'}
            if op == 'rgba.commit': return {'resourceId': 'r', 'version': 1, 'width': 1, 'height': 1, 'byteLength': 4}
            if op == 'resource.encode': return {'transferId': 'encoded', 'byteLength': len(encoded)}
            if op == 'transfer.read': return {'base64': images.base64.b64encode(encoded).decode('ascii')}
            if op == 'output.commit': self.assertEqual(Path('saved.png').read_bytes(), encoded)
            return {}
        previous = os.getcwd()
        try:
            with tempfile.TemporaryDirectory() as directory, patch.object(images, '_request', request):
                os.chdir(directory)
                Image.blank(1, 1).save('saved.png')
        finally:
            os.chdir(previous)
        self.assertLess([op for op, _ in calls].index('output.prepare'), [op for op, _ in calls].index('output.commit'))

    def test_superseded_uploads_release_owner_after_new_commit(self):
        calls = []
        version = 0
        def request(op, **fields):
            nonlocal version
            calls.append((op, fields))
            if op == 'rgba.begin': return {'transferId': 'rgba'}
            if op == 'rgba.commit':
                version += 1
                return {'resourceId': 'r', 'version': version, 'width': 1, 'height': 1, 'byteLength': 4}
            return {}
        with patch.object(images, '_request', request):
            image = Image.blank(1, 1)
            for n in range(300):
                image.set_rgb(0, 0, n, 0, 0)
                image._upload()  # The same path used by save and create_image.
            releases = [fields['version'] for op, fields in calls if op == 'resource.release']
            self.assertEqual(releases, list(range(1, 300)))
            self.assertEqual(image._previous, [])
            self.assertEqual([op for op, _ in calls][-2:], ['rgba.commit', 'resource.release'])
            image.close()

    def test_gc_queues_release_without_io_and_next_rpc_drains_it(self):
        calls = []
        class Service:
            def request(self, op, **fields):
                calls.append((op, fields))
                return {}
        with patch.object(images, '_service', Service()):
            image = Image.blank(1, 1)
            image._resource = {'resourceId': 'collected', 'version': 2}
            del image
            gc.collect()
            self.assertEqual(calls, [])
            images._request('capabilities')
            self.assertEqual([op for op, _ in calls], ['resource.release', 'capabilities'])
            self.assertEqual(images._pending_releases, [])

    def test_decoded_temporary_is_released_when_guest_budget_rejects(self):
        calls = []
        def request(op, **fields):
            calls.append(op)
            if op == 'encoded.begin': return {'transferId': 'encoded'}
            if op == 'encoded.decode': return {'resourceId': 'temporary', 'version': 1, 'width': 1, 'height': 1, 'byteLength': 4}
            return {}
        with tempfile.TemporaryDirectory() as directory, patch.object(images, '_request', request), patch.object(images, '_MAX_GUEST_BYTES', images._live_bytes):
            source = Path(directory) / 'source.png'
            source.write_bytes(b'encoded bytes')
            with self.assertRaises(ImageError): Image(str(source))
        self.assertIn('resource.release', calls)
        self.assertNotIn('resource.read', calls)

    def test_regular_guest_paths_and_bounded_repr(self):
        self.assertEqual(images._path('./pictures/../input.png'), 'input.png')
        self.assertEqual(images._path('/pictures/input.png'), '/pictures/input.png')
        self.assertEqual(images._path('../input.png'), '../input.png')
        image = Image.blank(1, 1)
        image.filename = 'x' * 10000
        self.assertLess(len(repr(image)), 300)
        self.assertIn('1', repr(image))

    def test_save_retries_receipt_and_releases_encoded_transfer_on_failure(self):
        calls = []
        def request(op, **fields):
            calls.append((op, fields))
            if op == 'rgba.begin': return {'transferId': 'rgba'}
            if op == 'rgba.commit': return {'resourceId': 'r', 'version': 1, 'width': 1, 'height': 1, 'byteLength': 4}
            if op == 'resource.encode': return {'transferId': 'encoded', 'byteLength': 4}
            if op == 'transfer.read': return {'base64': 'AQIDBA=='}
            if op == 'output.commit': raise ImageError('receipt failed', 'CANCELLED')
            return {}
        with tempfile.TemporaryDirectory() as directory, patch.object(images, '_request', request):
            destination = Path(directory) / 'saved.png'
            with self.assertRaisesRegex(ImageError, 'guest file was saved'):
                Image.blank(1, 1).save(str(destination))
            self.assertEqual(destination.read_bytes(), bytes([1, 2, 3, 4]))
        commits = [fields for op, fields in calls if op == 'output.commit']
        self.assertEqual(len(commits), 2)
        self.assertEqual(commits[0], commits[1])
        self.assertEqual(calls[-1], ('transfer.release', {'transferId': 'encoded'}))

    def test_show_reuses_resource_without_pixel_rpcs(self):
        calls = []
        def request(op, **fields):
            calls.append(op)
            if op == 'rgba.begin': return {'transferId': 't'}
            if op == 'rgba.commit': return {'resourceId': 'r', 'version': 1, 'width': 2, 'height': 2, 'byteLength': 16}
            return {}
        with patch.object(images, '_request', request):
            image = Image.blank(2, 2)
            for pixel in image: pixel.red = 100
            self.assertEqual(calls, [])
            image.show()
            image.show()
            self.assertEqual(calls.count('rgba.begin'), 1)
            self.assertEqual(calls.count('presentation.show'), 2)


if __name__ == '__main__':
    unittest.main()
