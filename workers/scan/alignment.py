"""Rigid CAD-mm to Gerber-mm registration; never assigns pad ownership."""
from hashlib import sha256
import json
import math
import numpy as np


def align(request):
    if not isinstance(request, dict) or set(request) != {'basis', 'scope', 'toleranceMm', 'points'}:
        raise ValueError('Invalid alignment request')
    if not isinstance(request['basis'], str) or len(request['basis']) > 8000 or not request['basis']:
        raise ValueError('Source interpretation identity is required')
    scope = request['scope']
    if not isinstance(scope, dict) or set(scope) != {'module', 'side', 'boardInstance'} or any(not isinstance(v, str) or not v.strip() or len(v) > 256 for v in scope.values()):
        raise ValueError('Select one module, side and Gerber board instance')
    tolerance = request['toleranceMm']
    if type(tolerance) not in (int, float) or not math.isfinite(tolerance) or not 0 < tolerance <= 10:
        raise ValueError('Tolerance must be greater than zero and at most 10 mm')
    points = request['points']
    if not isinstance(points, list) or not 4 <= len(points) <= 32:
        raise ValueError('Use 3 noncollinear fit points and at least 1 independent check point (32 maximum)')
    ids = set(); fit = []; checks = []
    for p in points:
        if not isinstance(p, dict) or set(p) != {'id', 'role', 'cad', 'gerber', 'evidence'}:
            raise ValueError('Invalid control point')
        if not isinstance(p['id'], str) or not p['id'] or len(p['id']) > 128 or p['id'] in ids:
            raise ValueError('Control point identities must be unique')
        ids.add(p['id'])
        if p['role'] not in ('fit', 'check') or not isinstance(p['evidence'], str) or not p['evidence'].strip() or len(p['evidence']) > 512:
            raise ValueError('Each correspondence needs a role and physical-match evidence')
        for frame in ('cad', 'gerber'):
            value = p[frame]
            if not isinstance(value, list) or len(value) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1e7 for v in value):
                raise ValueError('Control coordinates must be finite millimeters')
        (fit if p['role'] == 'fit' else checks).append(p)
    if len(fit) < 3 or len(checks) < 1:
        raise ValueError('At least 3 fit points and 1 held-out check point are required')
    for frame in ('cad', 'gerber'):
        coords = np.asarray([p[frame] for p in points], dtype=float)
        distances = np.linalg.norm(coords[:, None, :] - coords[None, :, :], axis=2)
        np.fill_diagonal(distances, np.inf)
        if np.any(distances < 1e-6):
            raise ValueError('Fit and check points must represent distinct physical positions')
    a = np.asarray([p['cad'] for p in fit], dtype=float); b = np.asarray([p['gerber'] for p in fit], dtype=float)
    ac = a - a.mean(axis=0); bc = b - b.mean(axis=0)
    for coords in (ac, bc):
        singular = np.linalg.svd(coords, compute_uv=False)
        if singular[0] < 1e-6 or singular[1] / singular[0] < 1e-3:
            raise ValueError('Fit points are collinear or too close to collinear')
    u, _, vt = np.linalg.svd(ac.T @ bc)
    rotation = u @ vt
    if np.linalg.det(rotation) <= 0:
        raise ValueError('These correspondences require a mirror; confirm the physical frame separately')
    translation = b.mean(axis=0) - a.mean(axis=0) @ rotation
    residuals = []
    for p in points:
        predicted = np.asarray(p['cad']) @ rotation + translation
        distance = float(np.linalg.norm(predicted - np.asarray(p['gerber'])))
        residuals.append({'id': p['id'], 'role': p['role'], 'predictedMm': predicted.tolist(), 'residualMm': distance, 'withinTolerance': distance <= tolerance})
    accepted = all(p['withinTolerance'] for p in residuals)
    return {'status': 'success' if accepted else 'blocked', 'artifactType': 'scan.rigid-alignment', 'schemaVersion': '1',
            'basis': request['basis'], 'scope': scope, 'toleranceMm': tolerance, 'points': points,
            'fingerprint': sha256(json.dumps(request, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest(),
            'transform': {'from': 'cad-mm', 'to': 'gerber-mm', 'scale': 1, 'mirror': False,
                          'angleDegrees': math.degrees(math.atan2(rotation[0, 1], rotation[0, 0])),
                          'matrix': [[float(rotation[0, 0]), float(rotation[1, 0]), float(translation[0])],
                                     [float(rotation[0, 1]), float(rotation[1, 1]), float(translation[1])]]},
            'residuals': residuals, 'maxResidualMm': max(p['residualMm'] for p in residuals),
            'holds': [] if accepted else ['One or more fit or independent check points exceed tolerance'],
            'qualification': 'User-selected correspondences only; native frames, pad ownership and machine compatibility are not validated',
            'machineExportAllowed': False}
