"""Uniform pixel similarity fit over explicitly reviewed correspondences.

No image recognition, native mutation, lens correction or physical qualification.
Native source binding is independently checked by the application's fresh reader.
"""
import math
import numpy as np


def fit_image_registration(r, fingerprint):
    scope, c, image = r['scope'], r['conventions'], r['image']
    if (scope['physicalSide'] not in ('top', 'bottom') or not scope['module'] or not scope['instance']
            or not scope['nativeRevision'] or scope['nativeRevision'] != scope['imageRevision']
            or any(scope[k] != c[k] for k in ('module', 'physicalSide', 'instance'))):
        raise ValueError('Matching revision, physical side and exact native/panel instance evidence is required.')
    if c['unit'] not in ('mm', 'in') or c['yDirection'] not in ('up', 'down') or c['roiAngle'] not in ('clockwise', 'counterclockwise') or c['anchor'] != 'native-roi-center' or c['distortion'] != 'uniform-similarity':
        raise ValueError('Native units/axes/ROI convention and uniform-distortion assumption must be established; no affine warp.')
    if any(not isinstance(v, str) or len(v.strip()) < 8 for v in (c['evidence'], r['scopeEvidence'], r['toleranceEvidence'])) or not r['reviewer'].strip():
        raise ValueError('Record the source/frame, tolerance and reviewer evidence before fitting.')
    tol = r['tolerancePx']
    if type(tol) not in (int, float) or not math.isfinite(tol) or not .01 <= tol <= 25:
        raise ValueError('Use a justified tolerance of 0.01–25 image pixels.')
    points = r['points']
    if len(points) < 4 or len(points) > 16 or len({p['id'] for p in points}) != len(points):
        raise ValueError('Use distinct feature identities: three fit controls and a separate check.')
    fit, checks = [], []
    for p in points:
        if p['role'] not in ('fit', 'check') or not p['identity'] or not p['beforeRoi'] or not isinstance(p['evidence'], str) or len(p['evidence'].strip()) < 8:
            raise ValueError('Every correspondence needs a unique native identity and same-feature evidence.')
        for frame in ('native', 'pixel'):
            value = p[frame]
            if not isinstance(value, list) or len(value) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1e9 for v in value):
                raise ValueError('Finite source and pixel coordinates are required.')
        if p['identity']['module'] != scope['module'] or not 0 <= p['pixel'][0] < image['width'] or not 0 <= p['pixel'][1] < image['height']:
            raise ValueError('A control belongs to another module or lies outside the selected image.')
        (fit if p['role'] == 'fit' else checks).append(p)
    if len(fit) < 3 or not checks:
        raise ValueError('Three fit controls and an independent check are required.')
    for frame in ('native', 'pixel'):
        coords = np.asarray([p[frame] for p in points], dtype=float)
        distances = np.linalg.norm(coords[:, None] - coords[None, :], axis=2)
        np.fill_diagonal(distances, np.inf)
        if np.any(distances < (1 if frame == 'pixel' else 1e-6)):
            raise ValueError('Fit/check controls must be disjoint spatial features.')
    a = np.asarray([p['native'] for p in fit], dtype=float)
    b = np.asarray([p['pixel'] for p in fit], dtype=float)
    handedness = -1 if c['yDirection'] == 'up' else 1
    a[:, 1] *= handedness
    ac, bc = a - a.mean(axis=0), b - b.mean(axis=0)
    for coords in (ac, bc):
        singular = np.linalg.svd(coords, compute_uv=False)
        if singular[0] < 1e-6 or singular[1] / singular[0] < 1e-3:
            raise ValueError('Fit controls are collinear or poorly conditioned.')
    bounds = r['nativeBounds']
    if not bounds or any(np.ptp(np.asarray([p['native'] for p in fit]), axis=0)[i] < .25 * (bounds[i+2] - bounds[i]) for i in (0, 1)):
        raise ValueError('Fit controls must span at least 25% of each native scope extent.')
    u, singular, vt = np.linalg.svd(ac.T @ bc)
    rotation = u @ vt
    if np.linalg.det(rotation) <= 0:
        raise ValueError('Controls require an unapproved mirror; review native axes and physical side.')
    scale = float(singular.sum() / (ac * ac).sum())
    if not 1e-6 <= scale <= 1e6:
        raise ValueError('Pixel scale exceeds the supported range.')
    translation = b.mean(axis=0) - a.mean(axis=0) @ (scale * rotation)
    matrix = [[float(scale*rotation[0,0]), float(scale*rotation[1,0]*handedness), float(translation[0])],
              [float(scale*rotation[0,1]), float(scale*rotation[1,1]*handedness), float(translation[1])]]
    residuals = []
    for p in points:
        n = np.asarray(p['native'], dtype=float); n[1] *= handedness
        predicted = n @ (scale * rotation) + translation
        residual = float(np.linalg.norm(predicted - p['pixel']))
        residuals.append({'id':p['id'], 'role':p['role'], 'predictedPx':predicted.tolist(), 'residualPx':residual, 'withinTolerance':residual <= tol})
    passed = all(p['withinTolerance'] for p in residuals)
    return {'status':'success' if passed else 'blocked', 'artifactType':'scan.image-registration-fit', 'schemaVersion':'1',
            'fingerprint':fingerprint, 'matrix':matrix, 'scalePixelsPerNativeUnit':scale,
            'pixelsPerMm':scale/(25.4 if c['unit']=='in' else 1), 'handedness':handedness,
            'residuals':residuals, 'maxResidualPx':max(p['residualPx'] for p in residuals),
            'holds':[] if passed else ['Fit or independent check exceeds the justified pixel tolerance.'],
            'qualification':'Numeric checks on reviewer-supplied physical/frame evidence; not Eagle/optical qualification.',
            'machineExportAllowed':False}
