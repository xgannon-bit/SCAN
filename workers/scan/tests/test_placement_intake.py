"""Entirely authored fixtures: no manufacturing source or derived geometry."""
import copy
from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

from openpyxl import Workbook
from workers.scan.placement_intake import IntakeError, inspect_table, normalize, read_table


CONFIG = {'startRow': 1, 'columns': {'refdes': 1, 'mpn': 2, 'xy': 3, 'side': 4, 'rotation': 5},
          'module': 'Fictional-A', 'side': '', 'units': 'mm', 'rotationDirection': 'ccw', 'decimalSeparator': '.', 'pairSeparator': ','}
ROWS = [['R7', '000-FICTIONAL', '1.25,-2', 'Top', 90], ['R7', 'OTHER-FICTIONAL', '0,0', 'Bottom', 0]]


def xlsx(rows=ROWS, merge=None):
    wb = Workbook()
    for row in rows: wb.active.append(row)
    if merge: wb.active.merge_cells(merge)
    data = io.BytesIO(); wb.save(data); wb.close()
    return data.getvalue()


def replace_member(data, member, transform):
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as original, zipfile.ZipFile(out, 'w') as result:
        for name in original.namelist():
            content = original.read(name)
            result.writestr(name, transform(content) if name == member else content)
    return out.getvalue()


class PlacementTests(unittest.TestCase):
    def run_import(self, rows=ROWS, config=None, data=None):
        data = data if data is not None else xlsx(rows)
        return normalize(read_table(data, 'xlsx'), data, config or copy.deepcopy(CONFIG))

    def test_headerless_combined_xy_keeps_first_record_and_zero(self):
        data = xlsx()
        result = self.run_import(data=data)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['counts']['parsed'], 2)
        self.assertEqual(result['sourceSha256'], sha256(data).hexdigest())
        self.assertEqual(result['placements'][0]['xMm'], '1.25')
        self.assertEqual(result['placements'][0]['yMm'], '-2')
        self.assertEqual(result['placements'][0]['mpn'], '000-FICTIONAL')
        self.assertEqual(result['placements'][1]['xMm'], '0')
        self.assertIsNone(result['coverage']['taught'])
        self.assertFalse(result['machineExportAllowed'])

    def test_units_and_direction_unknown_never_guess(self):
        config = copy.deepcopy(CONFIG); config.update(units='unknown', rotationDirection='unknown')
        result = self.run_import(config=config)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(len(result['holds']), 2)
        self.assertIsNone(result['placements'][0]['xMm'])
        self.assertIsNone(result['placements'][0]['rotationCcwDegrees'])
        self.assertEqual(result['placements'][0]['sourceCoordinates']['x'], '1.25')

    def test_long_decimal_coordinates_and_tiny_angles_are_not_rounded_to_zero(self):
        config = copy.deepcopy(CONFIG); config['rotationDirection'] = 'cw'
        literal = '1.123456789012345678901234567890123456789'
        result = self.run_import([['R7', 'P', literal + ',0', 'Top', '1e-40']], config)
        self.assertEqual(result['placements'][0]['xMm'], literal)
        self.assertEqual(result['placements'][0]['rotationCcwDegrees'], '359.' + '9'*40)

    def test_explicit_inches_clockwise_conversion_and_no_bottom_mirror(self):
        config = copy.deepcopy(CONFIG); config.update(units='inch', rotationDirection='cw')
        result = self.run_import(rows=[['R7', 'FICTIONAL', '1,-2', 'Bottom', 90]], config=config)
        self.assertEqual([result['placements'][0][k] for k in ('xMm', 'yMm', 'rotationCcwDegrees')], ['25.4', '-50.8', '270'])

    def test_explicit_separate_xy_header_row_and_mils(self):
        config = copy.deepcopy(CONFIG); config.update(startRow=2, units='mil')
        config['columns'] = {'refdes': 1, 'x': 2, 'y': 3, 'rotation': 4}; config['side'] = 'Top'
        result = self.run_import([['Ref', 'X', 'Y', 'Angle'], ['Q9', 1000, -2000, -90]], config)
        self.assertEqual(result['placements'][0]['sourceRow'], 2)
        self.assertEqual(result['placements'][0]['xMm'], '25.4000')
        self.assertEqual(result['placements'][0]['rotationCcwDegrees'], '270')
        self.assertEqual(result['counts']['warnings'], 1)

    def test_exact_identity_requires_module_and_side(self):
        config = copy.deepcopy(CONFIG); config['module'] = ''
        self.assertEqual(self.run_import(config=config)['counts']['errors'], 2)
        result = self.run_import(rows=[['R7', 'P', '0,0', 'unknown', 0]])
        self.assertEqual(result['counts']['errors'], 1)

    def test_duplicate_scoped_identity_blocks_without_dropping_records(self):
        result = self.run_import(ROWS + [ROWS[0]])
        self.assertEqual(result['counts']['parsed'], 3)
        self.assertEqual(result['counts']['errors'], 1)
        self.assertEqual(result['status'], 'blocked')
        self.assertNotEqual(result['placements'][0]['placementId'], result['placements'][1]['placementId'])

    def test_module_column_distinguishes_repeated_refs(self):
        config = copy.deepcopy(CONFIG); config['columns']['module'] = 6
        result = self.run_import([ROWS[0] + ['A'], ROWS[0] + ['B']], config)
        self.assertEqual(result['status'], 'success')
        self.assertNotEqual(result['placements'][0]['placementId'], result['placements'][1]['placementId'])

    def test_csv_quotes_utf8_bom_and_explicit_delimiter(self):
        data = '\ufeffR7;"Part;quoted";"1,2";Top;90\r\n'.encode('utf-8')
        result = normalize(read_table(data, 'csv', delimiter=';'), data, CONFIG)
        self.assertEqual(result['placements'][0]['mpn'], 'Part;quoted')
        self.assertEqual(result['counts']['parsed'], 1)
        with self.assertRaises(IntakeError): read_table(b'\xff', 'csv')

    def test_decimal_comma_pair_semicolon_numeric_cells_keep_native_decimal(self):
        config = copy.deepcopy(CONFIG); config.update(decimalSeparator=',', pairSeparator=';')
        result = self.run_import([['R7', 'Part', '1,25;-2,5', 'Top', 12.5]], config)
        self.assertEqual(result['placements'][0]['xMm'], '1.25')
        self.assertEqual(result['placements'][0]['rotationCcwDegrees'], '12.5')
        config['pairSeparator'] = ','
        with self.assertRaises(IntakeError): self.run_import(config=config)

    def test_bad_numbers_formulas_errors_and_numeric_identifiers_are_not_silent(self):
        for col, value in [(2, '1,NaN'), (2, '1e999,0'), (2, '1,2,3'), (2, None), (4, '=SUM(A1)'), (4, '#DIV/0!'), (0, 7), (1, 123)]:
            row = list(ROWS[0]); row[col] = value
            with self.subTest(col=col, value=value):
                result = self.run_import([row])
                self.assertEqual(result['status'], 'blocked')
                self.assertEqual(result['counts']['parsed'], 0)
                self.assertEqual(result['counts']['errors'], 1)
                self.assertNotIn('=SUM(A1)', json.dumps(result))

    def test_partial_errors_blank_rows_and_missing_mpn_remain_visible(self):
        result = self.run_import([ROWS[0], [None]*5, ['R8', None, '3,4', 'Top', 0], ['R9', 'P', 'bad', 'Top', 0]])
        self.assertEqual(result['counts'], {'sourceRows': 4, 'parsed': 2, 'skippedBlank': 1, 'errors': 1, 'warnings': 1})
        self.assertEqual(result['status'], 'blocked')

    def test_merged_mapped_cells_block_and_preview_redacts_formulas(self):
        result = self.run_import(data=xlsx(merge='A1:A2'))
        self.assertEqual(result['counts']['errors'], 2)
        data = xlsx([['=HYPERLINK("https://example.invalid")', 'P', '0,0', 'Top', 0]])
        self.assertEqual(inspect_table(read_table(data, 'xlsx'), data)['preview'][0][0], '[Formula]')

    def test_untrusted_dimension_metadata_does_not_drop_rows(self):
        data = replace_member(xlsx(), 'xl/worksheets/sheet1.xml', lambda b: b.replace(b'ref="A1:E2"', b'ref="A1:A1"'))
        self.assertEqual(self.run_import(data=data)['counts']['parsed'], 2)

    def test_excess_row_column_file_and_cell_limits(self):
        with self.assertRaises(IntakeError): read_table(b'a'*8_000_001, 'csv')
        with self.assertRaises(IntakeError): read_table(('a,'*65).encode(), 'csv')
        with self.assertRaises(IntakeError): read_table(b'a'*2049, 'csv')
        data = replace_member(xlsx(), 'xl/worksheets/sheet1.xml', lambda b: b.replace(b'r="1"', b'r="10001"'))
        with self.assertRaises(IntakeError): read_table(data, 'xlsx')

    def test_dtd_and_duplicate_zip_members_are_rejected(self):
        data = replace_member(xlsx(), 'xl/workbook.xml', lambda b: b'<!DOCTYPE a [<!ENTITY x SYSTEM "file:///never-read">]>' + b)
        with self.assertRaises(Exception): read_table(data, 'xlsx')
        data = io.BytesIO(xlsx())
        with zipfile.ZipFile(data, 'a') as archive: archive.writestr('../unexpected.xml', '<a/>')
        with self.assertRaises(IntakeError): read_table(data.getvalue(), 'xlsx')

    def test_mapping_rejects_overlap_and_missing_axes(self):
        for mapping in [{'refdes': 1, 'rotation': 5, 'x': 3}, {'refdes': 1, 'rotation': 5, 'x': 3, 'y': 3}, {'refdes': 1, 'rotation': 5, 'xy': 3, 'y': 2}]:
            config = copy.deepcopy(CONFIG); config['columns'] = mapping
            with self.assertRaises(IntakeError): self.run_import(config=config)

    def test_subprocess_returns_sanitized_errors_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'fictional.xlsx'; original = xlsx(); source.write_bytes(original)
            request = {'protocolVersion': '1', 'action': 'normalize', 'source': str(source), 'format': 'xlsx', 'sheetIndex': 0, 'delimiter': ',', 'config': CONFIG}
            proc = subprocess.run([sys.executable, '-m', 'workers.scan.placement_cli'], input=json.dumps(request).encode(), capture_output=True, timeout=10)
            self.assertEqual(proc.returncode, 0, proc.stdout)
            self.assertEqual(proc.stderr, b'')
            self.assertEqual(source.read_bytes(), original)
            source.write_bytes(b'bad private input')
            proc = subprocess.run([sys.executable, '-m', 'workers.scan.placement_cli'], input=json.dumps(request).encode(), capture_output=True, timeout=10)
            self.assertEqual(proc.returncode, 2)
            self.assertNotIn('private input', proc.stdout.decode())
            self.assertNotIn(str(source), proc.stdout.decode())


if __name__ == '__main__': unittest.main()
