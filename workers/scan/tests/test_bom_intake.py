"""Authored BOM groups; no manufacturing fixtures or expected board answers."""
import copy
import unittest
from workers.scan.bom_intake import expand_references, normalize_bom
from workers.scan.placement_intake import IntakeError, Table, read_table

CONFIG = {'headerRow': 1, 'columns': dict(zip(('quantity', 'refdes', 'value', 'description', 'manufacturer', 'mpn', 'footprint'), range(1, 8))), 'scope': {'module': '', 'side': '', 'boardInstance': ''}, 'revision': '', 'variant': ''}
HEADER = ['Quantity', 'Designator', 'Value', 'Description', 'Manufacturer', 'MPN', 'Footprint']

def parse(rows, config=None, merged=None):
    return normalize_bom(Table([HEADER, *rows], [{'name': 'Authored', 'index': 0}], merged or [], 0), b'authored literal source', config or copy.deepcopy(CONFIG))

class BomTests(unittest.TestCase):
    def test_group_ranges_preserve_literals_and_unknown_applicability(self):
        result = parse([[4, 'R1-R3, Cn8', '47K', 'Authored', 'Fiction', 'AB-7,TR', 'FABLE']])
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['counts']['uniqueReferences'], 4)
        self.assertEqual(result['references'][-1]['rawRefdes'], 'Cn8')
        self.assertEqual(result['references'][-1]['normalizedRefdes'], 'CN8')
        self.assertEqual(result['references'][0]['mpn'], 'AB-7,TR')
        self.assertEqual(result['references'][0]['scope']['module'], '')
        self.assertEqual(result['workOrderPopulation'], 'unapproved')
        self.assertFalse(result['machineExportAllowed'])

    def test_dnp_group_never_assigns_concatenated_mpn(self):
        result = parse([[2, 'C1 C2', 'DNP', '', '', '[NoValue] FICTION-A FICTION-B', '']])
        self.assertEqual(result['counts']['engineeringDnpReferences'], 2)
        self.assertTrue(all(item['mpn'] is None for item in result['references']))
        self.assertEqual(result['groups'][0]['raw']['mpn'], '[NoValue] FICTION-A FICTION-B')

    def test_duplicates_collisions_quantity_and_formula_are_held(self):
        rows = [[1, 'Cn1', '', '', '', 'A', ''], [1, 'CN1', '', '', '', 'B', ''], ['', 'R4', '', '', '', 'C', ''], [3, 'R5 R6', '', '', '', 'D', ''], [1, 'R7', '', '', '', {'special': 'f'}, '']]
        result = parse(rows)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual({item['code'] for item in result['issues']}, {'NORMALIZATION_COLLISION', 'QUANTITY_INVALID', 'QUANTITY_MISMATCH', 'UNSAFE_CELL'})
        self.assertNotIn('R7', [item['normalizedRefdes'] for item in result['references']])
        duplicate = parse([[1, 'R1', '', '', '', 'A', ''], [1, 'R1', '', '', '', 'A', '']])
        self.assertTrue(all(item['code'] == 'DUPLICATE_REFERENCE' for item in duplicate['issues']))

    def test_ambiguous_ranges_and_merged_evidence_refuse(self):
        for raw in ['R5-R1', 'R1-C3', 'R01-R03', 'R1-R9999', 'R1 r1', 'R1?']:
            with self.subTest(raw=raw), self.assertRaises(IntakeError): expand_references(raw)
        with self.assertRaisesRegex(IntakeError, 'Merged'):
            parse([[1, 'R1', '', '', '', 'A', '']], merged=[(2, 2, 2, 3)])
        config = copy.deepcopy(CONFIG); config['columns']['mpn'] = 2
        with self.assertRaises(IntakeError): parse([[1, 'R1', '', '', '', 'A', '']], config)

    def test_explicit_revision_variant_and_scope_are_retained_not_approved(self):
        config = copy.deepcopy(CONFIG); config.update(revision='AUTHORED-B', variant='EXPERIMENT'); config['scope'].update(module='A', side='Top', boardInstance='ONE')
        result = parse([[1, 'R1', '', '', '', 'A-B C', '']], config)
        self.assertEqual(result['config'], config)
        self.assertEqual(result['references'][0]['mpn'], 'A-B C')
        self.assertEqual(result['references'][0]['workOrderPopulation'], 'unapproved')

class CsvRecoveryTests(unittest.TestCase):
    def test_legacy_encoding_requires_explicit_choice(self):
        data = 'Refdes,Description\nR1,authored \u00e9\n'.encode('cp1252')
        with self.assertRaisesRegex(IntakeError, 'encoding'): read_table(data, 'csv')
        self.assertEqual(read_table(data, 'csv', encoding='windows-1252').rows[1][1], 'authored \u00e9')

    def test_only_final_description_recovers_under_explicit_opt_in(self):
        data = b'"Designator","X","Description"\n"R1","2.5","authored 1" part"\n'
        with self.assertRaisesRegex(IntakeError, 'malformed quoting'): read_table(data, 'csv')
        table = read_table(data, 'csv', csv_recovery=True)
        self.assertEqual(table.rows[1], ['R1', '2.5', 'authored 1" part'])
        self.assertEqual(len(table.interpretation_warnings), 1)
        for bad in [b'"R1" bad","2.5","description"', b'"R1","2" bad","description"']:
            with self.subTest(bad=bad), self.assertRaises(IntakeError):
                read_table(b'"Designator","X","Description"\n' + bad, 'csv', csv_recovery=True)
        with self.assertRaises(IntakeError): read_table(b'"R1","2.5","bad 1" quote"', 'csv', csv_recovery=True)

if __name__ == '__main__': unittest.main()
