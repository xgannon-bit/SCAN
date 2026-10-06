"""Bounded geometry for NEW disabled job-local preparation records.

This module never writes native or source files. Callers must separately validate
the supported native record/schema contract, unique identities, source hashes,
complete local window closure and exact reviewed acceptance. Returned fields are
for a newly cloned placement only; the original Master and its local windows are
not transformed, resized, retaught or declared machine compatible.

The rotation route is deliberately stricter than translation: one exact owned
pad layout, cardinal inverse source/native CAD angle deltas, aligned native
template angles, matching part/Master size, an explicit CAD-centered ROI, zero
Master CAD offset and a zero/zero stored-center pair. These are structural trial
conditions, not proof of the Eagle runtime's model/window transform. Unproved
origins, different geometry and generic model creation remain held.
"""
from decimal import Decimal, localcontext
import math

from .disabled_draft import _number, _rectangle, _text
from .qualification_candidate import _fail


PROFILE = 'native-model-cardinal-geometry-1'
_ZERO = Decimal(0)
_FULL = Decimal(360)
_BOUND = Decimal(1_000_000)


def _native(node, path):
    _number(node, path)
    return Decimal(_text(node, path))


def _source(value):
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1_000_000:
        _fail('PREPARATION_SOURCE_GEOMETRY', 'Source geometry requires bounded finite parsed numbers.')
    return Decimal(str(value))


def _angle(value):
    return (value % _FULL + _FULL) % _FULL


def _literal(value):
    if abs(value) > _BOUND:
        _fail('PREPARATION_GEOMETRY', 'New placement geometry exceeds the bounded native coordinate range.')
    result = format(value, 'f')
    if '.' in result:
        result = result.rstrip('0').rstrip('.')
    return '0' if not value else result


def source_geometry_signature(placed):
    """Exact numbered pad geometry in the footprint frame, without instance data.

    File paths, pattern/style labels, lexical numeric formatting, board position
    and board rotation do not establish or invalidate geometric equality. Pad
    numbers, layer numbers, local anchor coordinates, shape, dimensions and local
    orientation do. No nearest-distance matching, scaling or tolerance is used.
    """
    if (not isinstance(placed, dict) or placed.get('identityHolds') or
            placed.get('ownedPadCentersAvailable') is not True or
            placed.get('mountingEvidence') != 'explicit-zero-holes' or
            placed.get('isFlippedRaw') not in (None, 'False', 'false')):
        _fail('PREPARATION_SOURCE_GEOMETRY', 'Unique unflipped, zero-hole source-owned geometry is required.')
    layers = placed.get('explicitLayerGeometry')
    if not isinstance(layers, list) or not 1 <= len(layers) <= 128:
        _fail('PREPARATION_SOURCE_GEOMETRY', 'A bounded explicit numbered-layer footprint is required.')
    result, seen_layers, total = [], set(), 0
    for layer in layers:
        key = layer.get('layerNumber')
        if not isinstance(key, str) or not key.isascii() or not key.isdigit() or len(key) > 5 or key in seen_layers:
            _fail('PREPARATION_SOURCE_GEOMETRY', 'Layer identities must be exact, unique numbered literals.')
        seen_layers.add(key)
        pads = layer.get('pads')
        if not isinstance(pads, list) or not pads:
            _fail('PREPARATION_SOURCE_GEOMETRY', 'Every selected explicit layer requires owned pads.')
        total += len(pads)
        if total > 4096:
            _fail('PREPARATION_SOURCE_GEOMETRY', 'Footprint geometry exceeds the bounded pad count.')
        values, seen_pads = [], set()
        for pad in pads:
            number = pad.get('padNumber')
            if not isinstance(number, str) or not number or len(number) > 128 or number in seen_pads:
                _fail('PREPARATION_SOURCE_GEOMETRY', 'Pad identities must be unique within each explicit layer.')
            seen_pads.add(number)
            shape = pad.get('shape')
            if shape not in ('Rect', 'Oval', 'Ellipse'):
                _fail('PREPARATION_SOURCE_GEOMETRY', 'This geometry profile requires supported explicit pad shapes.')
            local = pad.get('local')
            if not isinstance(local, dict):
                _fail('PREPARATION_SOURCE_GEOMETRY', 'An explicit source-local pad center is required.')
            x, y = _source(local.get('xMm')), _source(local.get('yMm'))
            w, h = _source(pad.get('widthMm')), _source(pad.get('heightMm'))
            angle = _angle(_source(pad.get('localRotationDegrees')))
            if w <= 0 or h <= 0 or shape == 'Ellipse' and w != h:
                _fail('PREPARATION_SOURCE_GEOMETRY', 'Pad dimensions or ellipse interpretation are unsupported.')
            values.append((number, shape, x, y, w, h, angle))
        result.append((key, tuple(sorted(values))))
    return tuple(sorted(result))


def equivalent_source_geometry(target, origin):
    """Return exact geometry equivalence; invalid source geometry remains held."""
    return source_geometry_signature(target) == source_geometry_signature(origin)


def derive_model_geometry(target, origin, part, model, target_cad, template_cad):
    """Compute reviewed NEW-placement fields; never mutate supplied elements.

    Translation retains the native template's existing ROI/center offsets.
    A literal zero/zero stored-center pair is retained verbatim because it may
    represent unset data; it must not become a fabricated board coordinate.
    Rotated preparation copies the Master/local-window frame unchanged and
    explicitly leaves its Eagle transform and target settings unverified.
    """
    # The bounded native reader admits up to 2048 scalar characters. Preserve
    # their decimal arithmetic instead of rounding through the default context.
    with localcontext() as context:
        context.prec = 4096
        return _derive(target, origin, part, model, target_cad, template_cad)


def _derive(target, origin, part, model, target_cad, template_cad):
    if not equivalent_source_geometry(target, origin):
        _fail('PREPARATION_FOOTPRINT', 'Owned source-local pad identities and outlines differ; resizing or a guessed model origin is unsupported.')
    if target.get('side') != origin.get('side'):
        _fail('PREPARATION_SIDE', 'Source sides differ; a board-side transform is unsupported.')
    target_rotation = _source(target.get('rotation', {}).get('degrees'))
    template_rotation = _source(origin.get('rotation', {}).get('degrees'))
    source_delta = _angle(target_rotation - template_rotation)
    native_delta = _angle(_native(target_cad, 'Ang') - _native(template_cad, 'Ang'))
    _rectangle(part, 'Roi')
    _rectangle(model, 'Roi')
    px, py = _native(part, 'Roi/cx'), _native(part, 'Roi/cy')
    tx, ty = _native(target_cad, 'X'), _native(target_cad, 'Y')
    ox, oy = _native(template_cad, 'X'), _native(template_cad, 'Y')
    cx, cy = _native(part, 'CenterPosX'), _native(part, 'CenterPosY')
    zero_center = cx == cy == _ZERO
    same_pattern = (target.get('patternRef'), target.get('patternGraphicsNameRef')) == (origin.get('patternRef'), origin.get('patternGraphicsNameRef'))
    updates = {'Roi/cx': _literal(px + tx - ox), 'Roi/cy': _literal(py + ty - oy),
               'CenterPosX': _text(part, 'CenterPosX') if zero_center else _literal(cx + tx - ox),
               'CenterPosY': _text(part, 'CenterPosY') if zero_center else _literal(cy + ty - oy)}
    remaining = []
    route = 'same-angle-exact-local-pad-geometry'
    if native_delta == 0:
        if source_delta != 0:
            _fail('PREPARATION_ANGLE', 'Source rotation changed without a corresponding native CAD angle; no orientation is inferred.')
    else:
        if native_delta % 90 != 0 or source_delta != _angle(-native_delta):
            _fail('PREPARATION_ANGLE', 'Only exact cardinal inverse source/native CAD angle deltas are supported for this trial.')
        if (px, py) != (ox, oy):
            _fail('PREPARATION_ROTATION_ORIGIN', 'A rotated trial requires an exact template ROI at its native CAD anchor; nonzero origin offsets need a separately supported frame.')
        if not zero_center:
            _fail('PREPARATION_CENTER_FRAME', 'A nonzero stored-center frame cannot be rotated by this profile.')
        if (_angle(_native(part, 'Roi/a') - _native(template_cad, 'Ang')) or
                _angle(_native(part, 'Roi/a') - _native(model, 'Roi/a'))):
            _fail('PREPARATION_ROTATION_FRAME', 'Template placement, model and native CAD angles do not establish one exact trial orientation.')
        if ((_native(part, 'Roi/w'), _native(part, 'Roi/h')) != (_native(model, 'Roi/w'), _native(model, 'Roi/h')) or
                _native(model, 'CadOffset/X') != 0 or _native(model, 'CadOffset/Y') != 0):
            _fail('PREPARATION_ROTATION_FRAME', 'Rotated preparation requires matching native ROI sizes and explicit zero model CAD offsets.')
        updates.update({'Roi/cx': _literal(tx), 'Roi/cy': _literal(ty),
                        'Roi/a': _literal(_angle(_native(part, 'Roi/a') + native_delta))})
        route = 'cardinal-cad-origin-inverse-source-angle-trial'
        remaining.extend(['native-rotation-model-window-frame-unverified', 'target-orientation-and-polarity-verification-required'])
    if not same_pattern:
        remaining.append('alternate-pattern-body-and-template-settings-unverified')
    return {'profile': PROFILE, 'partUpdates': updates,
            'basis': {'geometryRoute': route, 'sourceFootprintComparison': 'exact-numbered-local-pad-geometry',
                      'samePatternAndGraphics': same_pattern,
                      'sourceAngleDeltaDegrees': float(source_delta), 'nativeCadAngleDeltaDegrees': float(native_delta),
                      'translationNativeUnits': [float(tx - ox), float(ty - oy)], 'nativeLengthUnit': 'unqualified',
                      'originOffsetPreserved': native_delta == 0,
                      'originPolicy': 'preserved-template-offset' if native_delta == 0 else 'exact-native-CAD-anchor-zero-template-offset',
                      'storedCenterPolicy': 'preserved-literal-zero-pair-unset-meaning-unqualified' if zero_center else 'translated-existing-offset-unqualified',
                      'modelGeometryPolicy': 'original-template-Master-Roi-and-CadOffset-preserved',
                      'windowGeometryPolicy': 'original-template-local-RelRoi-preserved',
                      'geometryQualification': 'structural-trial-not-Eagle-runtime-proof'},
            'remaining': remaining, 'machineExportAllowed': False, 'qualificationOnly': True}
