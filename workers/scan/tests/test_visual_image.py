"""Wholly authored raster headers, never production image fixtures."""
import struct
import tempfile
from pathlib import Path
import unittest
import zipfile
from hashlib import sha256
from workers.scan.visual_image import image_metadata, read_preserved_image

PNG = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 10, 20) + bytes(9)


class VisualImageTest(unittest.TestCase):
    def test_bounded_headers(self):
        self.assertEqual((image_metadata(PNG)['width'], image_metadata(PNG)['height']), (10, 20))
        jpeg = b'\xff\xd8\xff\xe0\x00\x04xx\xff\xc0\x00\x08\x08\x00\x20\x00\x30\x00'
        self.assertEqual(image_metadata(jpeg)['width'], 48)
        bmp = bytearray(54); bmp[:2] = b'BM'; bmp[14:18] = struct.pack('<I', 40); bmp[18:26] = struct.pack('<ii', 12, -24)
        self.assertEqual(image_metadata(bmp)['height'], 24)
        for bad in (b'II\x2a\x00', b'<svg/>', b'\xff\xd8\xff\xc0\xff\xff', PNG[:16] + struct.pack('>II', 40000, 40000) + bytes(9), PNG[:16] + struct.pack('>II', 0, 20) + bytes(9)):
            with self.assertRaises(ValueError): image_metadata(bad)

    def test_exact_member_hash_root_and_copy_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.zip'; member = 'Invented/Board/Scan.png'
            with zipfile.ZipFile(source, 'w') as z:
                z.writestr(member, PNG); z.writestr('Invented/Other/Scan.png', PNG)
            before = source.read_bytes()
            report = {'source': {'sha256': sha256(before).hexdigest()}, 'selection': {'root': 'Invented/Board'}, 'preservedFiles': [{'originalName': member, 'size': len(PNG), 'sha256': sha256(PNG).hexdigest()}]}
            result = read_preserved_image(source, report, member)
            self.assertEqual(result['registration'], 'unregistered'); self.assertEqual(source.read_bytes(), before)
            self.assertEqual((Path(directory) / 'result.image').read_bytes(), PNG)
            for wrong in ('Invented/Other/Scan.png', '../Scan.png', 'Invented/Board/missing.png'):
                with self.assertRaises(ValueError): read_preserved_image(source, report, wrong)
            report['preservedFiles'][0]['sha256'] = '0' * 64
            with self.assertRaises(ValueError): read_preserved_image(source, report, member)


if __name__ == '__main__': unittest.main()
