"""Invented source evidence; no production geometry or acceptance oracle."""
import unittest

from workers.scan.accel_ascii import read_accel
from workers.scan.tests.test_accel_ascii import pcb, STYLE, pattern, graphics


class ExplicitLayerTests(unittest.TestCase):
    def test_concrete_shapes_survive_unresolved_other_layers(self):
        style = STYLE[:-1] + '''(startRange 1)(endRange 2)
          (padShape (layerType Plane)(padShapeType Thrm4_45)
                    (outsideDiam 2)(insideDiam 1)(spokeWidth .1)))'''
        data = pcb(style=style)
        result = read_accel(data)
        part = result['placements'][0]
        self.assertFalse(part['geometryAvailable'])
        self.assertEqual(part['mountingEvidence'], 'explicit-zero-holes')
        layer = part['explicitLayerGeometry'][0]
        self.assertEqual(layer['layerNumber'], '1')
        self.assertFalse(layer['padStackResolved'])
        self.assertIsNone(layer['nativeTransform'])
        self.assertEqual(len(layer['unresolvedClassPaths']), 1)
        self.assertEqual(layer['pads'][1]['sourceBoardRotationDegrees'], 105)
        self.assertEqual(layer['pads'][0]['widthMm'], .8)
        self.assertEqual(read_accel(data), result)

    def test_duplicate_missing_unknown_or_zero_shapes_are_withheld(self):
        cases = [STYLE.replace('(layerNumRef 1)', '(layerType Signal)'),
                 STYLE.replace('(shapeWidth 0.8)', '(shapeWidth 0)'),
                 STYLE.replace('(shapeHeight 0.4)', '(shapeHeight 0.4)(scale 2)'),
                 STYLE.replace('(layerNumRef 1)', '(layerNumRef 1)(layerType Signal)'),
                 STYLE.replace('(holeDiam 0)', '(holeDiam 0)(unknownTransform 2)'),
                 STYLE[:-1] + '(padShape (layerNumRef 1)(padShapeType Rect)(shapeWidth 1)(shapeHeight 1)))']
        for style in cases:
            with self.subTest(style=style):
                self.assertEqual(read_accel(pcb(style=style))['placements'][0]['explicitLayerGeometry'], [])

    def test_holes_are_evidence_not_automatic_exclusions(self):
        for style, expected in [(STYLE.replace('(holeDiam 0)', '(holeDiam .6)'), 'hole-bearing'),
                                (STYLE.replace('(holeDiam 0)', ''), 'unknown')]:
            part = read_accel(pcb(style=style))['placements'][0]
            self.assertEqual(part['mountingEvidence'], expected)
            self.assertEqual(len(part['explicitLayerGeometry']), 1)

    def test_duplicate_identity_flip_and_via_block_layers(self):
        for args in [dict(placements=pattern()+pattern()),
                     dict(placements=pattern(extra='(isFlipped True)')),
                     dict(graph=graphics().replace('(multiLayer', '(multiLayer (via (pt 0 0))'))]:
            for part in read_accel(pcb(**args))['placements']:
                self.assertEqual(part['explicitLayerGeometry'], [])

    def test_layer_definitions_are_literal_not_side_inference(self):
        result = read_accel(pcb(extra='(layerDef "Authored copper" (layerNum 1)(layerType Signal))'))
        self.assertEqual(result['layerDefinitions'][0]['numberLiteral'], '1')
        self.assertEqual(result['layerDefinitions'][0]['typeLiteral'], 'Signal')
        self.assertIsNone(result['placements'][0]['side'])


if __name__ == '__main__':
    unittest.main()
