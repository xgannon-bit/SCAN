"""Wholly invented PCB text; no supplied job data or private regression oracle."""
from dataclasses import replace
from hashlib import sha256
import math
import unittest

from workers.scan.accel_ascii import AccelLimits, read_accel


STYLE = '''(padStyleDef "invented-pad"
  (holeDiam 0)
  (padShape (layerNumRef 1) (padShapeType Rect) (shapeWidth 0.8) (shapeHeight 0.4)))'''
PADS = '''(pad (padNum 1) (padStyleRef "invented-pad") (pt -1 0.5))
          (pad (padNum 2) (padStyleRef "invented-pad") (pt 3 0.5) (rotation 15))'''


def graphics(name='fictional', pads=PADS):
    return f'(patternGraphicsDef (patternGraphicsNameDef "{name}") (multiLayer {pads}))'


def pattern(ref='F7', angle='90', extra='', graphics_name='fictional'):
    selected = f'(patternGraphicsNameRef "{graphics_name}")' if graphics_name else ''
    return f'''(pattern (patternRef "offset-test") (refDesRef "{ref}")
      (pt 11 -4) (rotation {angle}) {selected} {extra})'''


def pcb(*, units='mm', placements=None, style=STYLE, graph=None, components=None, extra='', wrapped=False):
    if placements is None:
        placements = pattern()
    if graph is None:
        graph = graphics()
    if components is None:
        components = '(compInst "F7" (compRef "fictional-device") (originalName "F7") (compValue "authored-value"))'
    text = f'''ACCEL_ASCII "Author-created source"
      (asciiHeader (asciiVersion 3 0) (fileUnits {units}))
      (library {style} (patternDefExtended "offset-test" {graph}))
      (netlist {components})
      (pcbDesign "invented-board" (multiLayer {placements}) {extra})'''
    return ('(' + text + ')' if wrapped else text).encode('ascii')


class AccelSourceTests(unittest.TestCase):
    def test_exact_identity_source_hash_and_distinct_anchors(self):
        data = pcb()
        result = read_accel(data)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['sourceSha256'], sha256(data).hexdigest())
        self.assertEqual(result['sourceSize'], len(data))
        self.assertEqual(result['encoding'], 'ascii')
        self.assertEqual(result['asciiVersion'], ['3', '0'])
        item = result['placements'][0]
        self.assertEqual(item['component']['compRef'], 'fictional-device')
        self.assertEqual(item['anchor'], {'raw': ['11', '-4'], 'xMm': 11, 'yMm': -4})
        self.assertEqual(item['localPadBoundsMidpoint']['xMm'], 1)
        self.assertEqual(item['sourceOwnedPads'][0]['sourceBoardPoint'], {'xMm': 10.5, 'yMm': -5})
        self.assertNotEqual(item['anchor']['xMm'], item['localPadBoundsMidpoint']['xMm'])
        self.assertIsNone(item['side'])
        self.assertIsNone(result['coordinateFrame']['eagleTransform'])
        self.assertFalse(result['machineExportAllowed'])

    def test_raw_degrees_and_independent_source_board_rotation(self):
        expected = {'0': (10, -3.5), '90': (10.5, -5), '180': (12, -4.5),
                    '270': (11.5, -3), '-90': (11.5, -3)}
        for angle, coordinates in expected.items():
            with self.subTest(angle=angle):
                item = read_accel(pcb(placements=pattern(angle=angle)))['placements'][0]
                self.assertEqual(item['rotation']['degrees'], float(angle))
                point = item['sourceOwnedPads'][0]['sourceBoardPoint']
                self.assertEqual((point['xMm'], point['yMm']), coordinates)
        item = read_accel(pcb(placements=pattern(angle='30')))['placements'][0]
        point = item['sourceOwnedPads'][0]['sourceBoardPoint']
        self.assertAlmostEqual(point['xMm'], 11 - math.sqrt(3) / 2 - 0.25)
        self.assertAlmostEqual(point['yMm'], -4.5 + math.sqrt(3) / 4)
        self.assertEqual(item['sourceOwnedPads'][1]['rotation']['degrees'], 15)

    def test_declared_unit_conversion_is_only_scaling(self):
        for units, factor in [('mm', 1), ('MM', 1), ('mil', 0.0254), ('in', 25.4)]:
            with self.subTest(units=units):
                result = read_accel(pcb(units=units))
                self.assertEqual(result['status'], 'success')
                self.assertEqual(result['declaredUnits'], units)
                self.assertEqual(result['unitScaleToMm'], factor)
                self.assertAlmostEqual(result['placements'][0]['anchor']['xMm'], 11 * factor)
                self.assertAlmostEqual(result['padStyles'][0]['shapes'][0]['widthMm'], 0.8 * factor)

    def test_missing_or_unknown_units_never_default(self):
        for data in [pcb(units='cm'), pcb().replace(b'(fileUnits mm)', b'')]:
            result = read_accel(data)
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(len(result['placements']), 1)
            self.assertIsNone(result['placements'][0]['anchor']['xMm'])
            self.assertFalse(result['placements'][0]['geometryAvailable'])
            self.assertIn('EXPLICIT_SUPPORTED_UNITS_REQUIRED', [hold['code'] for hold in result['holds']])

    def test_wrapped_and_unwrapped_container(self):
        for wrapped in (False, True):
            result = read_accel(pcb(wrapped=wrapped))
            self.assertEqual(result['status'], 'success')
            self.assertEqual(len(result['placements']), 1)

    def test_named_graphics_selection_and_ambiguous_omission(self):
        other = graphics('other', '(pad (padNum 7) (padStyleRef "invented-pad") (pt 9 8))')
        result = read_accel(pcb(graph=graphics() + other, placements=pattern(graphics_name='other')))
        self.assertEqual(result['placements'][0]['sourceOwnedPads'][0]['padNumber'], '7')
        for graphs, selected in [(graphics() + other, None), (graphics() + graphics(), 'fictional'), (graphics(), 'missing')]:
            result = read_accel(pcb(graph=graphs, placements=pattern(graphics_name=selected)))
            self.assertEqual(result['status'], 'partial')
            self.assertFalse(result['placements'][0]['geometryAvailable'])
            self.assertEqual(result['placements'][0]['sourceOwnedPads'], [])

    def test_nested_graphics_never_silently_select_default_or_top_level_pads(self):
        alternatives = graphics('alternate', '(pad (padNum 19) (padStyleRef "invented-pad") (pt -8 6))')
        # Missing/conflicting/repeated selectors and unknown text/geometry fields
        # must not be replaced by a library default or an arbitrary first match.
        cases = [
            ('K31', 'fictional', '(patternGraphicsRef (patternGraphicsNameRef "alternate"))', graphics() + alternatives),
            ('Z9', None, '(patternGraphicsRef (patternGraphicsNameRef "alternate"))', '(patternGraphicsNameRef "fictional")' + graphics() + alternatives),
            ('D72', 'fictional', '(patternGraphicsRef (patternGraphicsNameRef "fictional") (patternGraphicsNameRef "fictional"))', graphics()),
            ('N4', 'alternate', '(patternGraphicsRef (patternGraphicsNameRef "absent"))', alternatives),
            ('H86', None, '(patternGraphicsRef (patternGraphicsNameRef "fictional")) (patternGraphicsRef (patternGraphicsNameRef "alternate"))', graphics() + alternatives),
            ('A25', 'fictional', '(patternGraphicsRef (attr "display" "authored") (isVisible True))', graphics()),
        ]
        for ordinal, (ref, selected, nested, graphs) in enumerate(cases):
            with self.subTest(ref=ref, selected=selected):
                placed = pattern(ref=ref, angle=str(ordinal * 30), graphics_name=selected, extra=nested)
                placed = placed.replace('(pt 11 -4)', f'(pt {ordinal + 2} {-ordinal - 3})')
                data = pcb(placements=placed, graph=graphs, components=f'(compInst "{ref}" (compRef "authored-{ordinal}"))')
                before = bytes(data)
                result = read_accel(data)
                self.assertEqual(data, before)
                self.assertEqual(result['sourceSha256'], sha256(before).hexdigest())
                self.assertEqual(result['adapterVersion'], 'accel-source-3')
                self.assertEqual(result['status'], 'partial')
                item = result['placements'][0]
                self.assertEqual(item['refdes'], ref)
                self.assertEqual(item['anchor']['xMm'], ordinal + 2)
                self.assertEqual(item['component']['compRef'], f'authored-{ordinal}')
                self.assertFalse(item['geometryAvailable'])
                self.assertFalse(item['ownedPadCentersAvailable'])
                self.assertEqual(item['sourceOwnedPads'], [])
                self.assertIsNone(item['localPadBoundsMidpoint'])
                blocked = [hold for hold in item['holds'] if hold['code'] == 'NESTED_PATTERN_GRAPHICS_UNSUPPORTED']
                self.assertEqual(len(blocked), len(item['rawFields']['patternGraphicsRef']))
                self.assertTrue(all(hold['sourcePath'].startswith(item['sourcePath'] + '/patternGraphicsRef[') for hold in blocked))
                self.assertFalse(result['machineExportAllowed'])

    def test_nested_graphics_hold_does_not_contaminate_an_independent_placement(self):
        placed = pattern(ref='A16', extra='(patternGraphicsRef (patternGraphicsNameRef "unsupported-alternate"))')
        placed += pattern(ref='B83', angle='180')
        result = read_accel(pcb(placements=placed, components='(compInst "A16") (compInst "B83")'))
        self.assertEqual(result['status'], 'partial')
        blocked, supported = result['placements']
        self.assertEqual(blocked['sourceOwnedPads'], [])
        self.assertTrue(supported['geometryAvailable'])
        self.assertTrue(supported['ownedPadCentersAvailable'])
        self.assertEqual(supported['sourceOwnedPads'][0]['sourceBoardPoint'], {'xMm': 12, 'yMm': -4.5})

    def test_same_name_nested_text_cannot_move_or_select_source_owned_pads(self):
        alternative = graphics('alternate', '(pad (padNum 19) (padStyleRef "invented-pad") (pt -8 6))')
        display = '''(patternGraphicsRef (patternGraphicsNameRef "alternate")
          (attr "RefDes" "DISPLAY-ONLY" (pt 73 -52) (rotation 41) (textStyleRef "authored-text") (isVisible True))
          (attr "Value" "NOT-GEOMETRY" (pt -40 89) (isVisible False)))'''
        for angle, expected in [('0', (3, 2)), ('90', (5, -12)), ('180', (19, -10))]:
            with self.subTest(angle=angle):
                data = pcb(graph=graphics() + alternative, placements=pattern(angle=angle, graphics_name='alternate', extra=display))
                result = read_accel(data)
                self.assertEqual(result['status'], 'success')
                self.assertEqual(result['sourceSha256'], sha256(data).hexdigest())
                item = result['placements'][0]
                self.assertTrue(item['ownedPadCentersAvailable'])
                self.assertEqual([pad['padNumber'] for pad in item['sourceOwnedPads']], ['19'])
                point = item['sourceOwnedPads'][0]['sourceBoardPoint']
                self.assertEqual((point['xMm'], point['yMm']), expected)
                metadata = item['graphicsTextMetadata']
                self.assertEqual(metadata['status'], 'supported-text-metadata')
                self.assertEqual(metadata['geometrySelection'], 'direct-placement-selector-only')
                self.assertEqual(metadata['attributes'][0]['valueLiteral'], 'DISPLAY-ONLY')
                self.assertEqual(item['refdes'], 'F7')
                self.assertFalse(result['machineExportAllowed'])

    def test_empty_same_name_text_block_is_not_an_alternate_geometry_selector(self):
        item = read_accel(pcb(placements=pattern(extra='(patternGraphicsRef (patternGraphicsNameRef "fictional"))')))['placements'][0]
        self.assertTrue(item['ownedPadCentersAvailable'])
        self.assertEqual(item['graphicsTextMetadata']['attributes'], [])

    def test_unsupported_nested_text_structure_still_withholds_geometry(self):
        for extra in [
            '(attr "Different" "text")', '(attr "RefDes")',
            '(attr "RefDes" "a") (attr "RefDes" "b")',
            '(attr "Value" "text" (mirror X))',
            '(attr "Value" "text" (pt 2 3) (pt 4 5))',
            '(attr "Value" "text" (rotation 4) (rotation 7))',
            '(attr "Value" "text" (isVisible Maybe))',
            '(attr "Value" "text" (isVisible True (padNum 1)))',
            '(attr "Value" (pt 2 3) "text")',
            '(scale 2)', '(pad (padNum 1) (pt 5 6))',
        ]:
            with self.subTest(extra=extra):
                item = read_accel(pcb(placements=pattern(extra=f'(patternGraphicsRef (patternGraphicsNameRef "fictional") {extra})')))['placements'][0]
                self.assertFalse(item['ownedPadCentersAvailable'])
                self.assertEqual(item['sourceOwnedPads'], [])
                self.assertEqual(item['graphicsTextMetadata']['status'], 'unsupported')
                self.assertIn('NESTED_PATTERN_GRAPHICS_UNSUPPORTED', [hold['code'] for hold in item['holds']])

    def test_missing_definition_or_style_preserves_placement(self):
        missing_definition = pcb().replace(b'(patternRef "offset-test")', b'(patternRef "absent")')
        missing_style = pcb(style='')
        for data in (missing_definition, missing_style):
            result = read_accel(data)
            self.assertEqual(result['status'], 'partial')
            item = result['placements'][0]
            self.assertEqual(item['refdes'], 'F7')
            self.assertEqual(item['anchor']['xMm'], 11)
            self.assertFalse(item['geometryAvailable'])
        self.assertEqual(len(read_accel(missing_style)['placements'][0]['sourceOwnedPads']), 2)
        self.assertTrue(read_accel(missing_style)['placements'][0]['ownedPadCentersAvailable'])

    def test_duplicate_style_and_pattern_ids_are_not_first_wins(self):
        for data in [pcb(style=STYLE + STYLE), pcb().replace(b'(netlist',
                    b'(library (patternDefExtended "offset-test")) (netlist')]:
            result = read_accel(data)
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(len(result['placements']), 1)
            self.assertFalse(result['placements'][0]['geometryAvailable'])
        data = pcb().replace(b'(patternDefExtended "offset-test"',
                             b'(patternDefExtended "offset-test") (patternDefExtended "offset-test"')
        result = read_accel(data)
        self.assertIn('AMBIGUOUS_PATTERN_DEFINITION', [h['code'] for h in result['placements'][0]['holds']])

    def test_duplicate_source_reference_keeps_both_exact_paths(self):
        result = read_accel(pcb(placements=pattern() + pattern(angle='180')))
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(len(result['placements']), 2)
        self.assertNotEqual(result['placements'][0]['sourcePath'], result['placements'][1]['sourcePath'])
        for item in result['placements']:
            self.assertIn('DUPLICATE_SOURCE_REFDES', [h['code'] for h in item['identityHolds']])

    def test_component_identity_is_exact_and_ambiguities_are_explicit(self):
        for components, code in [('', 'MISSING_COMPONENT_IDENTITY'),
                                ('(compInst "F7") (compInst "F7")', 'AMBIGUOUS_COMPONENT_IDENTITY'),
                                ('(compInst "f7")', 'MISSING_COMPONENT_IDENTITY')]:
            result = read_accel(pcb(components=components))
            item = result['placements'][0]
            self.assertIsNone(item['component'])
            self.assertIn(code, [h['code'] for h in item['identityHolds']])
            self.assertTrue(item['geometryAvailable'])

    def test_duplicate_pad_numbers_withhold_correspondence_geometry(self):
        result = read_accel(pcb(graph=graphics(pads=PADS.replace('(padNum 2)', '(padNum 1)'))))
        item = result['placements'][0]
        self.assertEqual(len(item['sourceOwnedPads']), 2)
        self.assertFalse(item['geometryAvailable'])
        self.assertTrue(all(pad['sourceBoardPoint'] is None for pad in item['sourceOwnedPads']))
        self.assertTrue(all(not pad['geometryAvailable'] for pad in item['sourceOwnedPads']))

    def test_explicit_false_flip_supported_but_no_side_inferred(self):
        item = read_accel(pcb(placements=pattern(extra='(isFlipped False)')))['placements'][0]
        self.assertTrue(item['geometryAvailable'])
        self.assertEqual(item['isFlippedRaw'], 'False')
        self.assertIsNone(item['side'])

    def test_unsupported_placement_and_board_transforms_hold_geometry(self):
        for extra in ['(isFlipped True)', '(isFlipped unknown)', '(scale 2)', '(mirror X)', '(origin 1 2)']:
            with self.subTest(extra=extra):
                item = read_accel(pcb(placements=pattern(extra=extra)))['placements'][0]
                self.assertFalse(item['geometryAvailable'])
                self.assertIsNone(item['sourceOwnedPads'][0]['sourceBoardPoint'])
                self.assertEqual(item['anchor']['xMm'], 11)
        item = read_accel(pcb(extra='(transform (scale 2))'))['placements'][0]
        self.assertFalse(item['geometryAvailable'])

    def test_duplicate_scalar_cannot_hide_a_second_placement_coordinate(self):
        item = read_accel(pcb(placements=pattern(extra='(pt 20 30)')))['placements'][0]
        self.assertFalse(item['geometryAvailable'])
        self.assertIsNone(item['anchor']['xMm'])
        self.assertEqual(len(item['rawFields']['pt']), 2)
        result = read_accel(pcb().replace(b'(fileUnits mm)', b'(fileUnits mm) (fileUnits mil)'))
        self.assertIsNone(result['unitScaleToMm'])

    def test_invalid_numeric_formats_are_not_coerced(self):
        for angle in ['NaN', 'inf', '1e2', '90deg', '1,5', '--2', '1000000001']:
            item = read_accel(pcb(placements=pattern(angle=angle)))['placements'][0]
            self.assertFalse(item['geometryAvailable'])
            self.assertIsNone(item['rotation']['degrees'])
        for point in [b'(pt 1 2 3)', b'(pt "1 cm" 2)', b'(pt 1 (evil 2))']:
            item = read_accel(pcb().replace(b'(pt 11 -4)', point))['placements'][0]
            self.assertFalse(item['geometryAvailable'])

    def test_optional_rotation_is_recorded_default(self):
        item = read_accel(pcb().replace(b'(rotation 90)', b''))['placements'][0]
        self.assertEqual(item['rotation'], {'raw': None, 'degrees': 0, 'defaulted': True})
        self.assertEqual(item['sourceOwnedPads'][0]['sourceBoardPoint'], {'xMm': 10, 'yMm': -3.5})

    def test_supported_pad_shapes_and_unqualified_approximations(self):
        for shape in ['Rect', 'Oval']:
            self.assertEqual(read_accel(pcb(style=STYLE.replace('Rect', shape)))['status'], 'success')
        for style in [STYLE.replace('Rect', 'Polygon'), STYLE.replace('Rect', 'RndRect'), STYLE.replace('Rect', 'Ellipse'),
                      STYLE.replace('(shapeWidth 0.8)', '(shapeWidth -1)'),
                      STYLE.replace('(shapeWidth 0.8)', '(shapeWidth 0.8) (offset 1 2)')]:
            result = read_accel(pcb(style=style))
            self.assertFalse(result['placements'][0]['geometryAvailable'])
            self.assertEqual(len(result['padStyles']), 1)
            self.assertTrue(result['placements'][0]['ownedPadCentersAvailable'])

    def test_escaped_and_multiline_strings_are_data_only(self):
        components = r'(compInst "F7" (compRef "quoted\"value\\tail") (compValue "text\nline"))'
        item = read_accel(pcb(components=components))['placements'][0]
        self.assertEqual(item['component']['compRef'], 'quoted"value\\tail')
        self.assertEqual(item['component']['compValue'], 'text\nline')
        item = read_accel(pcb(components='(compInst "F7" (compValue "line\nline"))'))['placements'][0]
        self.assertEqual(item['component']['compValue'], 'line\nline')
        result = read_accel(pcb(components=r'(compInst "F7" (compRef "bad\q"))'))
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['placements'][0]['component']['compRef'], r'bad\q')
        self.assertTrue(result['warnings'])

    def test_legacy_metadata_paths_remain_literal_and_unknown_text_order_is_retained(self):
        data = pcb(extra=r'(text (pt 1 2) "C:\Projects\Files")')
        result = read_accel(data)
        self.assertEqual(result['status'], 'success')
        self.assertTrue(result['warnings'])
        data = pcb(components=r'(compInst "F7" (compRef "C:\Projects\Device"))')
        self.assertEqual(read_accel(data)['placements'][0]['component']['compRef'], r'C:\Projects\Device')

    def test_explicit_coordinate_units_override_declared_file_units(self):
        for point in [b'(pt 11mm -4mm)', b'(pt 11 mm -4 mm)']:
            result = read_accel(pcb(units='mil').replace(b'(pt 11 -4)', point))
            self.assertEqual(result['placements'][0]['anchor']['xMm'], 11)
            self.assertEqual(result['placements'][0]['anchor']['yMm'], -4)
        result = read_accel(pcb().replace(b'(pt 11 -4)', b'(pt 100mil -1in)'))
        self.assertAlmostEqual(result['placements'][0]['anchor']['xMm'], 2.54)
        self.assertAlmostEqual(result['placements'][0]['anchor']['yMm'], -25.4)
        result = read_accel(pcb(style=STYLE.replace('shapeWidth 0.8', 'shapeWidth 10 mil')))
        self.assertAlmostEqual(result['padStyles'][0]['shapes'][0]['widthMm'], 0.254)

    def test_legacy_encoding_is_lossless_and_explicit_not_guessed(self):
        result = read_accel(pcb().replace(b'authored-value', b'legacy-\xe9'))
        self.assertEqual(result['encoding'], 'latin-1-byte-preserving')
        self.assertTrue(result['warnings'])
        self.assertEqual(result['placements'][0]['component']['compValue'].encode('latin-1'), b'legacy-\xe9')
        result = read_accel(b'\xef\xbb\xbf' + pcb())
        self.assertEqual(result['encoding'], 'utf-8-bom')
        self.assertEqual(read_accel(b'\xef\xbb\xbf' + pcb() + b'\xff')['status'], 'blocked')

    def test_malformed_delimiters_trailing_tokens_and_controls_block_all(self):
        for data in [pcb() + b')', pcb()[:-1], pcb() + b' trailing', pcb() + b'()',
                     pcb() + b'(bad "unterminated)', pcb() + b'(bad "joined"token)',
                     pcb() + b'\x00', b'(not-accel (pcbDesign))', pcb() + b'; ignored?',
                     pcb() + b'((wrong))', pcb() + b'(bad \xe9)']:
            with self.subTest(suffix=data[-25:]):
                result = read_accel(data)
                self.assertEqual(result['status'], 'blocked')
                self.assertEqual(result['placements'], [])

    def test_all_resource_limits_withhold_partial_geometry(self):
        cases = [('max_source_bytes', 4), ('max_tokens', 5), ('max_nodes', 4),
                 ('max_depth', 2), ('max_token_chars', 3), ('max_expanded_pads', 1),
                 ('max_output_bytes', 20)]
        for name, value in cases:
            result = read_accel(pcb(), limits=replace(AccelLimits(), **{name: value}))
            self.assertEqual(result['status'], 'blocked', name)
            self.assertEqual(result['placements'], [], name)
        result = read_accel(pcb(placements=pattern() + pattern()), limits=replace(AccelLimits(), max_placements=1))
        self.assertEqual(result['holds'][0]['code'], 'PLACEMENT_LIMIT')

    def test_no_empty_or_schematic_program_is_claimed_supported(self):
        for data in [b'ACCEL_ASCII "a" (schematicDesign)', pcb(placements='')]:
            result = read_accel(data)
            self.assertEqual(result['status'], 'unsupported')
            self.assertEqual(result['placements'], [])


if __name__ == '__main__':
    unittest.main()
