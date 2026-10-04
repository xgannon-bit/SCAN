import io
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from workers.scan.job_intake import IntakeLimits, inventory_zip
from workers.scan.zip_budget import ZipBudgetExceeded, check_zip_directory


class ZipBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.path = Path(self.temp.name) / 'authored.zip'
        with zipfile.ZipFile(self.path, 'w') as z:
            for n in range(8): z.writestr(f'synthetic-{n}.bin', b'x')

    def tearDown(self): self.temp.cleanup()

    def test_honest_directory_passes_and_metadata_limits_apply(self):
        check_zip_directory(self.path, 8)
        check_zip_directory(io.BytesIO(self.path.read_bytes()), 8)
        with self.assertRaises(ZipBudgetExceeded): check_zip_directory(self.path, 8, 2)

    def test_misleading_declared_count_cannot_hide_actual_records(self):
        data = bytearray(self.path.read_bytes()); end = data.rfind(b'PK\x05\x06')
        struct.pack_into('<HH', data, end + 8, 1, 1); self.path.write_bytes(data)
        with self.assertRaises(ZipBudgetExceeded): check_zip_directory(self.path, 4)
        with patch('workers.scan.job_intake.zipfile.ZipFile', side_effect=AssertionError('must not allocate ZipInfo')):
            result = inventory_zip(self.path, IntakeLimits(max_entries=4))
        self.assertEqual(result.status, 'blocked')

    def test_underdeclared_count_is_rejected_even_below_budget(self):
        data = bytearray(self.path.read_bytes()); end = data.rfind(b'PK\x05\x06')
        struct.pack_into('<HH', data, end + 8, 1, 1); self.path.write_bytes(data)
        with self.assertRaises(zipfile.BadZipFile): check_zip_directory(self.path, 10)

    def test_zip64_locator_and_prefixed_archives_fail_closed(self):
        raw = self.path.read_bytes(); end = raw.rfind(b'PK\x05\x06')
        self.path.write_bytes(raw[:end] + b'PK\x06\x07' + b'\0'*16 + raw[end:])
        with self.assertRaises(zipfile.BadZipFile): check_zip_directory(self.path, 10)
        self.path.write_bytes(b'prefix' + raw)
        with self.assertRaises(zipfile.BadZipFile): check_zip_directory(self.path, 10)

    def test_force_zip64_local_headers_used_by_snapshots_are_supported(self):
        with zipfile.ZipFile(self.path, 'w') as z:
            with z.open('opaque.bin', 'w', force_zip64=True) as f: f.write(b'fictional')
        check_zip_directory(self.path, 1)


if __name__ == '__main__': unittest.main()
