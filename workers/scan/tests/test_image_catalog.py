"""Authored image/model structures; no manufacturing bytes or private oracles."""
from hashlib import sha256
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from workers.scan.image_catalog import catalog_images, image_role
from workers.scan.visual_image import read_preserved_image

PNG = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 12, 20) + bytes(9)


class ImageCatalogTest(unittest.TestCase):
    def fixture(self, directory):
        source = Path(directory) / 'source.zip'
        assets = {'Invented/Board/whole.png': PNG, 'Invented/Master/PartImage/FICTIONAL-A.png': PNG,
                  'Invented/Master/PatternModel/opaque.tif': b'II*\0',
                  'Invented/Master/PartImage/bad.jpg': b'<svg/>',
                  'Other/Master/PartImage/FOREIGN.png': PNG}
        with zipfile.ZipFile(source, 'w') as archive:
            for name, data in assets.items(): archive.writestr(name, data)
        report = {'source': {'sha256': sha256(source.read_bytes()).hexdigest()}, 'packageSha256': 'a' * 64, 'snapshotId': 'invented',
                  'selection': {'root': 'Invented/Board', 'job': {'member': 'Invented/Board/Board.xml', 'role': 'main'},
                                'master': {'member': 'Invented/Master/Master_Temp.xml', 'role': 'temp'}},
                  'preservedFiles': [{'originalName': n, 'size': len(b), 'sha256': sha256(b).hexdigest()} for n,b in assets.items()]}
        return source, report

    def test_header_catalog_roles_no_decode_no_source_write_and_exact_master_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            source, report = self.fixture(directory); before = source.read_bytes()
            result = catalog_images(source, report)
            self.assertEqual(result['registration'], 'unregistered'); self.assertFalse(result['machineExportAllowed'])
            self.assertEqual(len(result['entries']), 4)
            self.assertEqual([e['role'] for e in result['entries']], ['board-candidate','model-reference','pattern-model','model-reference'])
            self.assertEqual(result['entries'][1]['dimensionEvidence'], 'raster-header-only')
            self.assertEqual(result['entries'][2]['preview'], 'held'); self.assertEqual(result['entries'][3]['preview'], 'held')
            self.assertEqual(source.read_bytes(), before)
            member = 'Invented/Master/PartImage/FICTIONAL-A.png'
            self.assertEqual(read_preserved_image(source,report,member)['sha256'],sha256(PNG).hexdigest())
            for wrong in ('Other/Master/PartImage/FOREIGN.png','Invented/Master/Other/whole.png','Invented/Board/../Master/PartImage/FICTIONAL-A.png'):
                with self.assertRaises(ValueError): read_preserved_image(source,report,wrong)

    def test_stale_hash_encoded_and_cumulative_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            source, report = self.fixture(directory)
            with patch('workers.scan.image_catalog.MAX_CATALOG_BYTES', len(PNG)):
                result = catalog_images(source,report)
                self.assertEqual(result['entries'][1]['preview'],'held')
            with patch('workers.scan.image_catalog.MAX_ASSETS',2):
                self.assertEqual(catalog_images(source,report)['omittedAssets'],2)
            report['preservedFiles'][0]['sha256']='0'*64
            with self.assertRaises(ValueError): catalog_images(source,report)

    def test_roles_cannot_prove_capture_channel_or_module(self):
        selection={'root':'Invented/Board','master':None}
        self.assertEqual(image_role('Invented/Board/UV_Module2.png',selection),'board-candidate')
        self.assertIsNone(image_role('Invented/Board/../Other.png',selection))
        self.assertIsNone(image_role(None,selection))


if __name__ == '__main__': unittest.main()
