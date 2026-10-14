"""Bounded, read-only asset catalog over an already verified explicit snapshot.

Folders describe storage roles only, not illumination, physical side, module or
OK-image semantics. Raster dimensions are headers, not a successful decode.
"""
from pathlib import PurePosixPath
from hashlib import sha256
import zipfile
from .visual_image import image_metadata, MAX_BYTES

MAX_ASSETS = 256
MAX_CATALOG_BYTES = 256_000_000
RASTERS = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'}


def image_role(member, selection):
    if not isinstance(member, str) or '\\' in member or any(p in ('..', '.') for p in member.split('/')):
        return None
    path = PurePosixPath(member)
    master = selection.get('master')
    if master:
        base = PurePosixPath(master['member']).parent
        if path.parent == base / 'PartImage':
            return 'model-reference'
        if path.parent == base / 'PatternModel':
            return 'pattern-model'
    root = selection['root']
    if member.startswith(root + '/'):
        return 'board-candidate' if str(path.parent) == root else 'other'
    return None


def catalog_images(source, report):
    entries, total = [], 0
    candidates = [f for f in report['preservedFiles']
                  if PurePosixPath(f['originalName']).suffix.lower() in RASTERS
                  and image_role(f['originalName'], report['selection'])]
    with zipfile.ZipFile(source) as archive:
        for f in candidates[:MAX_ASSETS]:
            member = f['originalName']
            role = image_role(member, report['selection'])
            entry = {'member': member, 'sha256': f['sha256'], 'size': f['size'],
                     'role': role, 'width': None, 'height': None, 'mime': None,
                     'preview': 'held', 'reason': '', 'dimensionEvidence': 'unavailable'}
            if PurePosixPath(member).suffix.lower() in ('.tif', '.tiff'):
                entry['reason'] = 'TIFF/pattern decoding is unsupported; no optical or algorithm semantics inferred.'
            elif not 0 < f['size'] <= MAX_BYTES or total + f['size'] > MAX_CATALOG_BYTES:
                entry['reason'] = 'Encoded asset or cumulative catalog inspection exceeds its bound.'
            else:
                total += f['size']
                data = archive.read(member)
                if len(data) != f['size'] or sha256(data).hexdigest() != f['sha256']:
                    raise ValueError('Catalog asset differs from the preserved snapshot.')
                try:
                    metadata = image_metadata(data)
                    entry.update({k: metadata[k] for k in ('width', 'height', 'mime')})
                    entry.update(preview='supported-header', reason='Original bytes verified; decode on selection.', dimensionEvidence='raster-header-only')
                except ValueError:
                    entry['reason'] = 'Raster header is malformed, unsupported or exceeds dimension limits.'
            entries.append(entry)
    return {'status': 'success', 'artifactType': 'scan.image-catalog', 'schemaVersion': '1',
            'sourceSha256': report['source']['sha256'], 'packageSha256': report['packageSha256'],
            'snapshotId': report['snapshotId'], 'selection': report['selection'],
            'entries': entries, 'omittedAssets': max(0, len(candidates) - len(entries)),
            'registration': 'unregistered', 'machineExportAllowed': False}
