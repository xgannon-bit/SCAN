"""Bounded read-only ACCEL_ASCII PCB source evidence, not an Eagle adapter.

This independently authored reader supports explicit units, pattern placements
and source-owned pad centers/styles in patternDefExtended graphics. It does not
infer component ownership from proximity or equate layout pads with stencil or
inspection windows. Unknown source material is never rewritten.

Format evidence: https://dev-docs.kicad.org/en/import-formats/pcad/ and KiCad's
pcad_pad.cpp / pcad2kicad_common.cpp. The implementation's StrToInt1Units multiplies
a raw angle by ten before constructing a tenths-of-degree angle: raw rotation
values are degrees, despite the prose documentation describing internal tenths.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from hashlib import sha256
import json
import math
import re


@dataclass(frozen=True)
class AccelLimits:
    max_source_bytes: int = 20_000_000
    max_tokens: int = 750_000
    max_nodes: int = 200_000
    max_depth: int = 64
    max_token_chars: int = 4096
    max_placements: int = 10_000
    max_expanded_pads: int = 50_000
    max_output_bytes: int = 12_000_000


class _Reject(ValueError):
    pass


@dataclass
class _Node:
    tag: str
    path: str
    args: list[str] = field(default_factory=list)
    children: list['_Node'] = field(default_factory=list)
    argument_child_offsets: list[int] = field(default_factory=list)

    def all(self, tag):
        return [child for child in self.children if child.tag == tag]


_NUMBER = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\Z', re.ASCII)
_KEYWORD = re.compile(r'[A-Za-z][A-Za-z0-9_]*\Z', re.ASCII)
_FACTORS = {'mm': Decimal('1'), 'mil': Decimal('0.0254'), 'in': Decimal('25.4')}


def _tokens(text, limits, warnings=None):
    """Consume every character; no regex search that silently skips bad input."""
    index = 0
    count = 0
    while index < len(text):
        char = text[index]
        if char in ' \t\r\n':
            index += 1
            continue
        count += 1
        if count > limits.max_tokens:
            raise _Reject('TOKEN_LIMIT')
        if char in '()':
            yield char, char
            index += 1
            continue
        start = index
        if char == '"':
            index += 1
            value = []
            while index < len(text) and text[index] != '"':
                char = text[index]
                if char == '\\':
                    index += 1
                    if index == len(text):
                        raise _Reject('UNTERMINATED_STRING_ESCAPE')
                    if text[index] not in '\\"nrt':
                        # Legacy metadata commonly contains bare Windows paths.
                        # Retain an unknown pair literally; never strip its slash
                        # or interpret it as code, a path, or an identifier alias.
                        value.append('\\')
                        if warnings is not None:
                            warnings['literalUnknownEscapes'] += 1
                    char = {'n': '\n', 'r': '\r', 't': '\t'}.get(text[index], text[index])
                elif ord(char) < 32 and char not in '\r\n\t':
                    raise _Reject('CONTROL_CHARACTER')
                value.append(char)
                index += 1
                if index - start > limits.max_token_chars:
                    raise _Reject('TOKEN_LENGTH_LIMIT')
            if index == len(text):
                raise _Reject('UNTERMINATED_STRING')
            index += 1
            if index < len(text) and text[index] not in ' \t\r\n()':
                raise _Reject('MISSING_TOKEN_SEPARATOR')
            yield 'string', ''.join(value)
        else:
            while index < len(text) and text[index] not in ' \t\r\n()':
                char = text[index]
                if ord(char) < 33 or ord(char) > 126 or char in '"\\;':
                    raise _Reject('UNSUPPORTED_BARE_TOKEN')
                index += 1
                if index - start > limits.max_token_chars:
                    raise _Reject('TOKEN_LENGTH_LIMIT')
            yield 'atom', text[start:index]


def _parse(text, limits, warnings=None):
    root = _Node('$document', '')
    stack = [root]
    counts = [Counter()]
    node_count = 0
    awaiting_tag = False
    for kind, value in _tokens(text, limits, warnings):
        if kind == '(':
            if awaiting_tag:
                raise _Reject('MISSING_LIST_KEYWORD')
            if len(stack) > limits.max_depth:
                raise _Reject('DEPTH_LIMIT')
            awaiting_tag = True
        elif awaiting_tag:
            if kind != 'atom' or not _KEYWORD.fullmatch(value):
                raise _Reject('INVALID_LIST_KEYWORD')
            node_count += 1
            if node_count > limits.max_nodes:
                raise _Reject('NODE_LIMIT')
            counts[-1][value] += 1
            path = f'{stack[-1].path}/{value}[{counts[-1][value]}]'
            node = _Node(value, path)
            stack[-1].children.append(node)
            stack.append(node)
            counts.append(Counter())
            awaiting_tag = False
        elif kind == ')':
            if len(stack) == 1:
                raise _Reject('UNEXPECTED_CLOSE')
            stack.pop()
            counts.pop()
        else:
            if stack[-1].children and len(stack) == 1:
                raise _Reject('POSITIONAL_TOKEN_AFTER_CHILD')
            stack[-1].args.append(value)
            stack[-1].argument_child_offsets.append(len(stack[-1].children))
    if awaiting_tag or len(stack) != 1:
        raise _Reject('UNCLOSED_LIST')
    if not root.args and len(root.children) == 1 and root.children[0].tag == 'ACCEL_ASCII':
        root = root.children[0]
    elif root.args and root.args[0] == 'ACCEL_ASCII':
        root.args = root.args[1:]
    else:
        raise _Reject('ACCEL_SIGNATURE_REQUIRED')
    if len(root.args) > 1:
        raise _Reject('INVALID_DOCUMENT_HEADER')
    return root, node_count


def _hold(holds, code, path):
    item = {'code': code, 'sourcePath': path}
    if item not in holds:
        if len(holds) >= 1000:
            raise _Reject('FINDING_LIMIT')
        holds.append(item)


def _one(node, tag, holds, required=True):
    found = node.all(tag)
    if len(found) != 1:
        if found or required:
            _hold(holds, 'DUPLICATE_FIELD' if found else 'MISSING_FIELD', node.path + '/' + tag)
        return None
    return found[0]


def _scalar(node, tag, holds, required=True):
    child = _one(node, tag, holds, required)
    if child is None:
        return None
    if len(child.args) != 1 or child.children or not child.args[0]:
        _hold(holds, 'INVALID_SCALAR', child.path)
        return None
    return child.args[0]


def _raw(node):
    # Repeated fields retain every literal value. Nested fields stay identified
    # by source path; original bytes and their hash remain the authoritative text.
    values = defaultdict(list)
    for child in node.children:
        values[child.tag].append({'sourcePath': child.path, 'values': child.args,
                                  'argumentChildOffsets': child.argument_child_offsets,
                                  'nestedFields': [nested.tag for nested in child.children]})
    return dict(values)


def _number(raw, holds, path, factor=Decimal(1), positive=False, nonnegative=False):
    if raw is None:
        return None
    if len(raw) > 32 or not _NUMBER.fullmatch(raw):
        _hold(holds, 'INVALID_NUMBER', path)
        return None
    value = Decimal(raw)
    if (positive and value <= 0) or (nonnegative and value < 0) or abs(value) > Decimal('1000000000'):
        _hold(holds, 'NUMBER_OUT_OF_RANGE', path)
        return None
    if factor is None:
        return None
    value *= factor
    if abs(value) > Decimal('1000000'):
        _hold(holds, 'CONVERTED_NUMBER_OUT_OF_RANGE', path)
        return None
    return float(value)


def _quantity(raw, holds, path, factor, nonnegative=False):
    """P-CAD permits explicit per-value units overriding fileUnits.

    KiCad pcad2kicad_common.cpp GetAndCutWordWithMeasureUnits reads both
    concatenated and whitespace-separated units before falling back to fileUnits.
    """
    if raw is None:
        return None
    match = re.fullmatch(r'([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))\s*(mm|mil|in)?', raw, re.IGNORECASE | re.ASCII)
    if match is None:
        _hold(holds, 'INVALID_LENGTH', path)
        return None
    selected = _FACTORS[match[2].lower()] if match[2] else factor
    return _number(match[1], holds, path, selected, nonnegative=nonnegative)


def _length(node, tag, holds, factor, required=True):
    child = _one(node, tag, holds, required)
    if child is None:
        return None, None
    if child.children or not 1 <= len(child.args) <= 2:
        _hold(holds, 'INVALID_LENGTH', child.path)
        return child.args, None
    raw = ' '.join(child.args)
    return raw, _quantity(raw, holds, child.path, factor, nonnegative=True)


def _point(node, holds, factor):
    child = _one(node, 'pt', holds)
    result = {'raw': None, 'xMm': None, 'yMm': None}
    if child is None:
        return result
    result['raw'] = child.args
    lengths = []
    for arg in child.args:
        if arg.lower() in _FACTORS and lengths and not re.search(r'[A-Za-z]', lengths[-1]):
            lengths[-1] += ' ' + arg
        else:
            lengths.append(arg)
    if len(lengths) != 2 or child.children:
        _hold(holds, 'INVALID_POINT', child.path)
    else:
        result['xMm'] = _quantity(lengths[0], holds, child.path, factor)
        result['yMm'] = _quantity(lengths[1], holds, child.path, factor)
    return result


def _rotation(node, holds):
    count = len(node.all('rotation'))
    raw = _scalar(node, 'rotation', holds, False)
    return {'raw': raw, 'degrees': 0.0 if count == 0 else _number(raw, holds, node.path + '/rotation'),
            'defaulted': count == 0}


def _unknown(node, allowed, holds, named=False):
    if len(node.args) != (1 if named else 0):
        _hold(holds, 'UNSUPPORTED_POSITIONAL_VALUES', node.path)
    for child in node.children:
        if child.tag not in allowed:
            _hold(holds, 'UNSUPPORTED_GEOMETRY_FIELD', child.path)


def _index(nodes, holds):
    result = defaultdict(list)
    for node in nodes:
        if len(node.args) != 1 or not node.args[0]:
            _hold(holds, 'INVALID_DEFINITION_ID', node.path)
        else:
            result[node.args[0]].append(node)
    for matches in result.values():
        if len(matches) > 1:
            for node in matches:
                _hold(holds, 'DUPLICATE_DEFINITION_ID', node.path)
    return result


def _resolve(index, key, holds, path, kind):
    matches = index.get(key, [])
    if len(matches) != 1:
        _hold(holds, ('AMBIGUOUS_' if matches else 'MISSING_') + kind, path)
        return None
    return matches[0]


def _style(node, factor):
    holds = []
    _unknown(node, {'holeDiam', 'isHolePlated', 'padShape'}, holds, named=True)
    hole, hole_mm = _length(node, 'holeDiam', holds, factor, False)
    shapes = []
    for shape in node.all('padShape'):
        shape_holds = []
        _unknown(shape, {'layerNumRef', 'padShapeType', 'shapeWidth', 'shapeHeight'}, shape_holds)
        layer = _scalar(shape, 'layerNumRef', shape_holds)
        if layer is not None and not re.fullmatch(r'[0-9]{1,5}', layer, re.ASCII):
            _hold(shape_holds, 'INVALID_LAYER_ID', shape.path)
        kind = _scalar(shape, 'padShapeType', shape_holds)
        width, width_mm = _length(shape, 'shapeWidth', shape_holds, factor)
        height, height_mm = _length(shape, 'shapeHeight', shape_holds, factor)
        if kind not in {'Rect', 'Oval', 'Ellipse'}:
            _hold(shape_holds, 'UNSUPPORTED_PAD_SHAPE', shape.path)
        # Do not approximate an ellipse as an oblong based on an importer.
        if kind == 'Ellipse' and width_mm != height_mm:
            _hold(shape_holds, 'ELLIPSE_GEOMETRY_UNQUALIFIED', shape.path)
        shapes.append({'sourcePath': shape.path, 'layerNumRef': layer, 'shapeType': kind,
                       'widthRaw': width, 'heightRaw': height, 'widthMm': width_mm, 'heightMm': height_mm,
                       'geometryAvailable': not shape_holds and width_mm is not None and height_mm is not None,
                       'holds': shape_holds})
        holds.extend(shape_holds)
    layers = Counter(shape['layerNumRef'] for shape in shapes if shape['layerNumRef'] is not None)
    if any(count > 1 for count in layers.values()):
        _hold(holds, 'AMBIGUOUS_PAD_LAYER', node.path)
    if not shapes:
        _hold(holds, 'MISSING_PAD_SHAPES', node.path)
    return {'sourcePath': node.path, 'name': node.args[0], 'holeDiameterRaw': hole,
            'holeDiameterMm': hole_mm, 'shapes': shapes, 'holds': holds,
            'geometryAvailable': not holds and factor is not None}


def _graphics(definition, selected, holds):
    _unknown(definition, {'originalName', 'patternGraphicsNameRef', 'patternGraphicsDef'}, holds, named=True)
    if selected is None and definition.all('patternGraphicsNameRef'):
        selected = _scalar(definition, 'patternGraphicsNameRef', holds)
    graphics = definition.all('patternGraphicsDef')
    names = []
    for graphic in graphics:
        local_holds = []
        name = _scalar(graphic, 'patternGraphicsNameDef', local_holds, False)
        if local_holds:
            holds.extend(local_holds)
        names.append((name, graphic))
    if selected is not None:
        choices = [graphic for name, graphic in names if name == selected]
    else:
        choices = graphics
    if len(choices) != 1:
        _hold(holds, 'AMBIGUOUS_PATTERN_GRAPHICS' if choices else 'MISSING_PATTERN_GRAPHICS', definition.path)
        return None
    graphic = choices[0]
    if selected is None and len(graphics) > 1:
        _hold(holds, 'AMBIGUOUS_PATTERN_GRAPHICS', definition.path)
        return None
    _unknown(graphic, {'patternGraphicsNameDef', 'multiLayer', 'layerContents'}, holds)
    return _one(graphic, 'multiLayer', holds)


def _graphics_text_metadata(node, selected, holds, factor):
    """Validate the supported instance text block without selecting pad geometry.

    Primary importer: https://docs.kicad.org/doxygen/pcad__pcb_8cpp_source.html
    DoPCBComponents (source lines 293-311) uses the direct placement selector for
    library geometry. SetTextProperty (218-270) finds a same-name nested block
    only for RefDes/Value text. Library selection is in FindPatternMultilayerSection:
    https://docs.kicad.org/doxygen/pcad__footprint_8cpp_source.html (158-187).
    This narrow profile accepts one same-name block, with only known text fields.
    It never promotes a nested name into an absent direct geometry selector.
    """
    references = node.all('patternGraphicsRef')
    if not references:
        return None
    metadata = {'status': 'unsupported', 'geometrySelection': 'direct-placement-selector-only',
                'sourcePaths': [reference.path for reference in references], 'nameLiteral': selected,
                'attributes': [], 'interpretation': 'Instance RefDes/Value display metadata; no pad transform or geometry override applied.'}
    local_holds = []
    if len(references) != 1 or selected is None:
        for reference in references:
            _hold(holds, 'NESTED_PATTERN_GRAPHICS_UNSUPPORTED', reference.path)
        return metadata
    reference = references[0]
    _unknown(reference, {'patternGraphicsNameRef', 'attr'}, local_holds)
    name = _scalar(reference, 'patternGraphicsNameRef', local_holds)
    if name != selected:
        _hold(local_holds, 'NESTED_GRAPHICS_NAME_MISMATCH', reference.path)
    attribute_names = set()
    for attribute in reference.all('attr'):
        if (len(attribute.args) != 2 or attribute.argument_child_offsets != [0, 0]
                or attribute.args[0] not in ('RefDes', 'Value') or attribute.args[0] in attribute_names):
            _hold(local_holds, 'UNSUPPORTED_GRAPHICS_TEXT_ATTRIBUTE', attribute.path)
            continue
        attribute_names.add(attribute.args[0])
        for child in attribute.children:
            if child.tag not in {'pt', 'rotation', 'textStyleRef', 'isVisible'}:
                _hold(local_holds, 'UNSUPPORTED_GRAPHICS_TEXT_FIELD', child.path)
        if attribute.all('pt'):
            _point(attribute, local_holds, factor)
        _rotation(attribute, local_holds)
        _scalar(attribute, 'textStyleRef', local_holds, False)
        visible = _scalar(attribute, 'isVisible', local_holds, False)
        if visible not in (None, 'True', 'False', 'true', 'false'):
            _hold(local_holds, 'UNSUPPORTED_GRAPHICS_TEXT_VISIBILITY', attribute.path)
        metadata['attributes'].append({'sourcePath': attribute.path, 'name': attribute.args[0],
                                       'valueLiteral': attribute.args[1], 'rawFields': _raw(attribute)})
    if local_holds:
        holds.extend(local_holds)
        _hold(holds, 'NESTED_PATTERN_GRAPHICS_UNSUPPORTED', reference.path)
    else:
        metadata['status'] = 'supported-text-metadata'
    return metadata


def _board_point(anchor, local, rotation):
    angle = rotation % 360
    cardinal = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}
    c, s = cardinal.get(angle, (math.cos(math.radians(angle)), math.sin(math.radians(angle))))
    return {'xMm': anchor['xMm'] + c * local['xMm'] - s * local['yMm'],
            'yMm': anchor['yMm'] + s * local['xMm'] + c * local['yMm']}


def _extract(root, result, limits):
    holds = result['holds']
    header = _one(root, 'asciiHeader', holds)
    library = _one(root, 'library', holds)
    netlist = _one(root, 'netlist', holds, False)
    design = _one(root, 'pcbDesign', holds)
    if root.all('schematicDesign'):
        _hold(holds, 'SCHEMATIC_NOT_PCB', root.path)
    if header:
        result['declaredUnits'] = _scalar(header, 'fileUnits', holds)
        version = _one(header, 'asciiVersion', holds)
        if version:
            if version.children or not 1 <= len(version.args) <= 4:
                _hold(holds, 'INVALID_ASCII_VERSION', version.path)
            else:
                result['asciiVersion'] = version.args
    units = result['declaredUnits']
    factor = _FACTORS.get(units.lower()) if units else None
    result['unitScaleToMm'] = float(factor) if factor is not None else None
    if factor is None:
        _hold(holds, 'EXPLICIT_SUPPORTED_UNITS_REQUIRED', header.path if header else root.path)
    if not design or root.all('schematicDesign'):
        return
    if library is None:
        library = _Node('library', '/unresolved-library')
    style_index = _index(library.all('padStyleDef'), holds)
    pattern_index = _index(library.all('patternDefExtended'), holds)
    component_index = _index(netlist.all('compInst') if netlist else [], holds)
    style_cache = {key: _style(nodes[0], factor) for key, nodes in style_index.items() if len(nodes) == 1}
    result['padStyles'] = list(style_cache.values())
    result['definitionInventory'] = [
        {'kind': child.tag, 'sourcePath': child.path, 'literalIds': child.args}
        for child in library.children if child.tag in {'padStyleDef', 'patternDefExtended', 'patternDef', 'compDef'}]
    result['componentInventory'] = [
        {'sourcePath': node.path, 'literalIds': node.args, 'rawFields': _raw(node)}
        for node in netlist.all('compInst')] if netlist else []
    board_layers = design.all('multiLayer')
    board_holds = []
    for container in [design, *board_layers]:
        for child in container.children:
            if re.search(r'flip|mirror|transform|scale|offset|origin|rotation', child.tag, re.IGNORECASE):
                _hold(board_holds, 'UNSUPPORTED_BOARD_TRANSFORM', child.path)
    holds.extend(board_holds)
    if len(board_layers) != 1:
        _hold(holds, 'AMBIGUOUS_BOARD_MULTILAYER' if board_layers else 'MISSING_BOARD_MULTILAYER', design.path)
    nodes = [node for layer in board_layers for node in layer.all('pattern')]
    if len(nodes) > limits.max_placements:
        raise _Reject('PLACEMENT_LIMIT')
    expanded = 0
    geometry_cache = {}
    for node in nodes:
        local_holds = board_holds.copy()
        refdes = _scalar(node, 'refDesRef', local_holds)
        pattern_ref = _scalar(node, 'patternRef', local_holds)
        graphics_ref = _scalar(node, 'patternGraphicsNameRef', local_holds, False)
        anchor = _point(node, local_holds, factor)
        rotation = _rotation(node, local_holds)
        flipped = _scalar(node, 'isFlipped', local_holds, False)
        _unknown(node, {'patternRef', 'refDesRef', 'pt', 'rotation', 'isFlipped', 'patternGraphicsNameRef',
                        'patternGraphicsRef', 'originalName', 'isFixed', 'attr'}, local_holds)
        if flipped not in (None, 'False', 'false'):
            _hold(local_holds, 'FLIPPED_PLACEMENT_UNSUPPORTED', node.path)
        graphics_metadata = _graphics_text_metadata(node, graphics_ref, local_holds, factor)
        if len(board_layers) != 1:
            _hold(local_holds, 'AMBIGUOUS_BOARD_MULTILAYER', node.path)
        item = {'sourcePath': node.path, 'refdes': refdes, 'patternRef': pattern_ref,
                'patternGraphicsNameRef': graphics_ref, 'graphicsTextMetadata': graphics_metadata, 'rawFields': _raw(node),
                'anchor': anchor, 'rotation': rotation, 'isFlippedRaw': flipped, 'side': None,
                'component': None, 'sourceOwnedPads': [], 'localPadBoundsMidpoint': None,
                'geometryAvailable': False, 'ownedPadCentersAvailable': False, 'holds': local_holds}
        result['placements'].append(item)
        component_holds = []
        component = _resolve(component_index, refdes, component_holds, node.path, 'COMPONENT_IDENTITY')
        if component:
            item['component'] = {'sourcePath': component.path,
                                 'compRef': _scalar(component, 'compRef', component_holds, False),
                                 'originalName': _scalar(component, 'originalName', component_holds, False),
                                 'compValue': _scalar(component, 'compValue', component_holds, False)}
        item['identityHolds'] = component_holds
        definition = _resolve(pattern_index, pattern_ref, local_holds, node.path, 'PATTERN_DEFINITION')
        if definition is None:
            continue
        if graphics_metadata is not None and graphics_metadata['status'] != 'supported-text-metadata':
            # Preserve identity while refusing absent/conflicting selectors or
            # any instance graphics outside the explicitly supported text schema.
            continue
        cache_key = (definition.path, graphics_ref)
        if cache_key not in geometry_cache:
            definition_holds = []
            layer = _graphics(definition, graphics_ref, definition_holds)
            pads = []
            if layer:
                _unknown(layer, {'pad', 'via', 'attr'}, definition_holds)
                if layer.all('via'):
                    _hold(definition_holds, 'PATTERN_VIA_GEOMETRY_UNSUPPORTED', layer.path)
                pads = layer.all('pad')
            geometry_cache[cache_key] = (layer, pads, definition_holds)
        layer, pads, definition_holds = geometry_cache[cache_key]
        local_holds.extend(definition_holds)
        if layer is None:
            continue
        expanded += len(pads)
        if expanded > limits.max_expanded_pads:
            raise _Reject('EXPANDED_PAD_LIMIT')
        for pad in pads:
            pad_holds = []
            pad_number = _scalar(pad, 'padNum', pad_holds)
            style_ref = _scalar(pad, 'padStyleRef', pad_holds)
            local = _point(pad, pad_holds, factor)
            pad_rotation = _rotation(pad, pad_holds)
            _unknown(pad, {'padNum', 'padStyleRef', 'pt', 'rotation', 'netNameRef', 'defaultPinDes'}, pad_holds)
            center_available = not pad_holds and local['xMm'] is not None and local['yMm'] is not None
            style_node = _resolve(style_index, style_ref, pad_holds, pad.path, 'PAD_STYLE')
            style = style_cache.get(style_ref) if style_node else None
            if style and not style['geometryAvailable']:
                _hold(pad_holds, 'PAD_STYLE_GEOMETRY_UNAVAILABLE', pad.path)
            item['sourceOwnedPads'].append({'sourcePath': pad.path, 'placementSourcePath': node.path,
                'patternSourcePath': definition.path, 'padNumber': pad_number, 'padStyleRef': style_ref,
                'local': local, 'rotation': pad_rotation, 'sourceBoardPoint': None,
                'padStyleSourcePath': style_node.path if style_node else None,
                'centerAvailable': center_available,
                'geometryAvailable': not pad_holds and factor is not None, 'holds': pad_holds})
        numbers = Counter(pad['padNumber'] for pad in item['sourceOwnedPads'] if pad['padNumber'])
        for pad in item['sourceOwnedPads']:
            if numbers[pad['padNumber']] > 1:
                _hold(pad['holds'], 'AMBIGUOUS_PAD_NUMBER', pad['sourcePath'])
                pad['geometryAvailable'] = False
                pad['centerAvailable'] = False
        if not pads:
            _hold(local_holds, 'MISSING_PATTERN_PADS', layer.path)
        item['geometryAvailable'] = (not local_holds and factor is not None
                                     and all(pad['geometryAvailable'] for pad in item['sourceOwnedPads']))
        # A known center does not imply a complete pad outline or layer stack.
        # Explicit point/ownership evidence remains useful when a style contains
        # unsupported thermal, drill-span, or layer-type declarations.
        item['ownedPadCentersAvailable'] = (not local_holds and factor is not None
                                            and all(pad['centerAvailable'] for pad in item['sourceOwnedPads']))
        if item['ownedPadCentersAvailable']:
            for pad in item['sourceOwnedPads']:
                pad['sourceBoardPoint'] = _board_point(anchor, pad['local'], rotation['degrees'])
            xs = [pad['local']['xMm'] for pad in item['sourceOwnedPads']]
            ys = [pad['local']['yMm'] for pad in item['sourceOwnedPads']]
            item['localPadBoundsMidpoint'] = {'xMm': (min(xs) + max(xs)) / 2, 'yMm': (min(ys) + max(ys)) / 2,
                                             'meaning': 'Bounds midpoint of pad centers; not the placement anchor or body center'}
    references = Counter(item['refdes'] for item in result['placements'] if item['refdes'])
    for item in result['placements']:
        if references[item['refdes']] > 1:
            _hold(item['identityHolds'], 'DUPLICATE_SOURCE_REFDES', item['sourcePath'])
    result['uninterpretedTopLevelSections'] = [node.tag for node in root.children
                                             if node.tag not in {'asciiHeader', 'library', 'netlist', 'pcbDesign'}]


def read_accel(data: bytes, *, limits: AccelLimits | None = None) -> dict:
    """Read source-owned layout evidence. Partial results retain exact identities.

    Geometry availability is per placement/pad; success never authorizes machine
    writes. No native machine state, schematic reconstruction or Gerber ownership
    is inferred. Latin-1 fallback is explicitly byte-preserving, not a code-page
    identification. The caller retains the immutable original bytes.
    """
    limits = limits or AccelLimits()
    if any(type(value) is not int or value <= 0 for value in asdict(limits).values()):
        raise ValueError('ACCEL limits must be positive integers')
    if not isinstance(data, bytes):
        raise TypeError('ACCEL source must be bytes')
    result = {'artifactType': 'scan.accel-source-model', 'schemaVersion': '1', 'adapterVersion': 'accel-source-3',
              'status': 'blocked', 'sourceSha256': sha256(data).hexdigest(), 'sourceSize': len(data),
              'encoding': None, 'declaredUnits': None, 'asciiVersion': None, 'unitScaleToMm': None,
              'coordinateFrame': {'name': 'source-file-cartesian', 'yAxis': 'up', 'rotation': 'degrees-counterclockwise',
                                  'sourceOriginUnchanged': True, 'eagleTransform': None},
              'placements': [], 'padStyles': [], 'componentInventory': [], 'definitionInventory': [],
              'holds': [], 'warnings': [], 'machineExportAllowed': False,
              'limitations': ['Supported source layout evidence only; not a qualified Eagle reader or writer.',
                              'Nested graphics support is limited to one same-name RefDes/Value text block with an explicit direct placement selector; other nested forms withhold pad geometry.',
                              'Pad ownership follows explicit pattern definitions; no Gerber/window binding is inferred.',
                              'Layer numbers and flip flags do not establish a verified inspection side or module.',
                              'Original bytes remain authoritative; this adapter does not serialize or edit source files.']}
    try:
        if not data or len(data) > limits.max_source_bytes:
            raise _Reject('SOURCE_BYTE_LIMIT')
        if data.startswith(b'\xef\xbb\xbf'):
            text = data[3:].decode('utf-8', 'strict')
            result['encoding'] = 'utf-8-bom'
        elif all(byte < 128 for byte in data):
            text = data.decode('ascii')
            result['encoding'] = 'ascii'
        else:
            text = data.decode('latin-1')
            result['encoding'] = 'latin-1-byte-preserving'
            result['warnings'].append('Legacy non-ASCII bytes retained one-to-one; their original code page is unverified.')
        lexer_warnings = Counter()
        root, count = _parse(text, limits, lexer_warnings)
        if lexer_warnings['literalUnknownEscapes']:
            result['warnings'].append(f"{lexer_warnings['literalUnknownEscapes']} unknown quoted backslash sequences retained literally; identifiers use exact literal matching only.")
        result['parsedNodeCount'] = count
        result['designName'] = root.args[0] if root.args else None
        _extract(root, result, limits)
        failed = (result['holds'] or any(item['holds'] or item['identityHolds'] or not item['geometryAvailable']
                                       for item in result['placements']))
        result['status'] = 'partial' if failed else 'success'
        if not result['placements']:
            result['status'] = 'unsupported'
            _hold(result['holds'], 'NO_SUPPORTED_PLACEMENTS', '/pcbDesign/multiLayer')
        if len(json.dumps(result, ensure_ascii=True, allow_nan=False).encode('ascii')) > limits.max_output_bytes:
            raise _Reject('OUTPUT_BYTE_LIMIT')
    except (_Reject, UnicodeDecodeError) as error:
        # Syntax/aggregate-bound failures withhold partial geometry. Never expose
        # raw file contents through an exception or label truncated data complete.
        code = str(error) if isinstance(error, _Reject) else 'INVALID_UTF8'
        result.update(status='blocked', placements=[], padStyles=[], componentInventory=[], definitionInventory=[])
        result['holds'] = [{'code': code, 'sourcePath': '/'}]
    return result
