"""Read-only manufacturer/body evidence, independently of centroid coordinates.

This module receives no proposed/CSV position and fits no per-component offset.
It reuses the constructors' owned geometry/pin/drawing checks without invoking
native seeds, record insertion, binding or machine operations.
"""
from hashlib import sha256
import json
import math

from .accel_ascii import read_accel
from .paired_terminal_constructor import validate_profiles
from .snapshot_capture import CaptureBlocked


def _digest(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def body_evidence(pcb, profiles, bom):
    profiles = validate_profiles(profiles)
    layout = read_accel(pcb)
    if layout.get('status') not in ('success', 'partial') or not layout.get('placements'):
        raise CaptureBlocked('ORIGIN_LAYOUT', 'A supported PCB source containing owned placements is required.')
    if not isinstance(bom, dict) or bom.get('artifactType') != 'scan.engineering-bom' or not isinstance(bom.get('references'), list):
        raise CaptureBlocked('ORIGIN_BOM', 'Fresh parsed BOM evidence is required.')
    if len(bom['references']) > 10000 or len(layout['placements']) > 10000:
        raise CaptureBlocked('ORIGIN_LIMIT', 'Source or BOM exceeds the bounded reference count.')
    refs = {}
    for row in bom['references']:
        refs.setdefault(row['normalizedRefdes'], []).append(row)
    records = []
    for target in layout['placements']:
        component = target.get('component') or {}
        matching = [p for p in profiles if (p['patternRef'], p['graphicsRef'], p['compRef']) ==
                    (target.get('patternRef'), target.get('patternGraphicsNameRef'), component.get('compRef')) and
                    ('targetSourcePaths' not in p or target['sourcePath'] in p['targetSourcePaths'])]
        if not matching:
            continue
        for profile in matching:
            record = {'reference': target['refdes'], 'sourcePath': target['sourcePath'], 'profileId': profile['id'],
                      'profileSha256': _digest(profile), 'status': 'held', 'bodyLocalMm': None, 'bodyBoardMm': None,
                      'bodySizeMm': None, 'sourceRotationDegrees': target['rotation']['degrees'], 'sourceSide': target['side'],
                      'drawingSha256': profile['drawing']['sha256'], 'holds': [], 'mpnMatched': False}
            records.append(record)
            if len(records) > 1000:
                raise CaptureBlocked('ORIGIN_LIMIT', 'At most 1,000 matched body-evidence records are supported.')
            try:
                if len(matching) != 1:
                    raise CaptureBlocked('ORIGIN_BODY_AMBIGUOUS', 'Multiple package profiles match this source; choose independently supported evidence.')
                rows = refs.get((target.get('refdes') or '').strip().upper(), [])
                if len(rows) != 1 or not rows[0].get('quantityMatches'):
                    raise CaptureBlocked('ORIGIN_BOM_IDENTITY', 'One unambiguous BOM row with reconciled quantity is required.')
                row = rows[0]
                if row.get('mpn') not in profile['nativePartNames']:
                    raise CaptureBlocked('ORIGIN_BOM_PACKAGE', 'Actual BOM manufacturer identity does not match the reviewed drawing profile.')
                if target.get('identityHolds') or target.get('isFlippedRaw') not in (None, 'False', 'false'):
                    raise CaptureBlocked('ORIGIN_SOURCE_IDENTITY', 'Unique unflipped owned source geometry is required; no side is inferred.')
                record['mpnMatched'] = True
                kind = profile['kind']
                if kind == 'numbered-external-terminal-thermal-body-v1':
                    from .thermal_terminal_constructor import source_geometry
                elif kind == 'numbered-physical-terminal-body-v1':
                    from .physical_terminal_constructor import source_geometry
                elif kind == 'polarized-three-terminal-body-v1':
                    from .three_terminal_constructor import source_geometry
                elif kind == 'polarized-two-terminal-body-v1':
                    from .diode_constructor import source_geometry
                else:
                    from .paired_terminal_constructor import source_geometry
                geom = source_geometry(target, profile, pcb)
                origin = target.get('anchor') or {}
                angle = target['rotation']['degrees']
                values = [origin.get('xMm'), origin.get('yMm'), angle, *geom['center'], geom['bodyWidth'], geom['bodyHeight']]
                if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
                    raise CaptureBlocked('ORIGIN_BODY_GEOMETRY', 'Finite declared source geometry is required.')
                c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle)); x, y = geom['center']
                record.update(status='supported', bodyLocalMm=[x, y], bodyBoardMm=[origin['xMm']+c*x-s*y, origin['yMm']+s*x+c*y],
                              bodySizeMm=[geom['bodyWidth'], geom['bodyHeight']])
            except CaptureBlocked as error:
                record['holds'].append({'code': error.code, 'message': str(error)})
    result = {'status': 'success', 'artifactType': 'scan.source-body-evidence', 'schemaVersion': '1',
              'layoutSha256': layout['sourceSha256'], 'bomSha256': bom['sourceSha256'], 'profilesSha256': _digest(profiles),
              'records': records, 'machineQualified': False, 'nativeEditsApplied': False}
    result['evidenceSha256'] = _digest(result)
    return result
