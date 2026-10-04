"""Preserve the complete source ZIP with evidence; never write native job XML."""
from hashlib import sha256
import json
from pathlib import Path
import zipfile


def prepare_reference(source, destination, review):
    source = Path(source); destination = Path(destination)
    if review.get('artifactType') != 'scan.archive-review' or review.get('status') != 'success' or review.get('machineExportAllowed') is not False:
        raise ValueError('A verified source review is required')
    expected = review['preflight']['source']['sha256']; size = review['preflight']['source']['size']
    if size > 100_000_000 or source.stat().st_size != size: raise ValueError('Native source size changed')
    manifest = {'artifactType': 'scan.preserved-native-reference', 'schemaVersion': '1', 'nativeEditsApplied': False,
                'machineCompatibility': None, 'machineExportAllowed': False, 'candidateId': None,
                'sourceArchive': {'path': 'NATIVE_SOURCE.zip', 'sha256': expected, 'size': size},
                'review': review}
    raw = json.dumps(manifest, ensure_ascii=True, indent=2).encode()
    if len(raw) > 24_000_000: raise ValueError('Reference evidence exceeds its limit')
    instructions = ('SCAN PRESERVED NATIVE SOURCE PACKAGE\n\n'
        'NATIVE_SOURCE.zip is an exact copy of the complete supplied ZIP, including all native files, images, snapshots and other original contents.\n'
        'SCAN has applied NO native edits. This package does not generate a new program from CAD/Gerber and does not establish Eagle compatibility.\n'
        'SCAN_REFERENCE.json records the explicitly selected job/Master paths and roles, source hashes, native literal-reference checks and unresolved holds.\n\n'
        'Extract NATIVE_SOURCE.zip into a separate local working folder. Keep every source file and directory. Do not overwrite the original.\n'
        'An authorized operator should use the selected native job in the intended Eagle version, record its exact build and import workflow, save a separate copy, reopen it, and ZIP the returned tree for SCAN Handoff comparison.\n'
        'Do not substitute temporary/backup snapshots automatically. Machine teaching and optical validation remain separate.\n')
    created = False
    try:
        digest = sha256()
        with destination.open('xb') as output:
            created = True
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as bundle:
                info = zipfile.ZipInfo('NATIVE_SOURCE.zip'); info.file_size = size
                with source.open('rb') as incoming, bundle.open(info, 'w') as target:
                    remaining = size
                    while remaining:
                        chunk = incoming.read(min(1024 * 1024, remaining))
                        if not chunk: raise ValueError('Native source was truncated')
                        digest.update(chunk); target.write(chunk); remaining -= len(chunk)
                    if incoming.read(1) or digest.hexdigest() != expected: raise ValueError('Native source hash changed')
                bundle.writestr(zipfile.ZipInfo('SCAN_REFERENCE.json'), raw)
                bundle.writestr(zipfile.ZipInfo('README.txt'), instructions.encode())
        # Independently reopen and hash the output's complete native payload.
        with zipfile.ZipFile(destination) as bundle:
            if set(bundle.namelist()) != {'NATIVE_SOURCE.zip', 'SCAN_REFERENCE.json', 'README.txt'}: raise ValueError('Unexpected output entries')
            actual = sha256()
            with bundle.open('NATIVE_SOURCE.zip') as incoming:
                while chunk := incoming.read(1024 * 1024): actual.update(chunk)
            if actual.hexdigest() != expected: raise ValueError('Output native source hash mismatch')
            if bundle.read('SCAN_REFERENCE.json') != raw: raise ValueError('Output evidence mismatch')
        output_hash = sha256()
        with destination.open('rb') as handle:
            while chunk := handle.read(1024 * 1024): output_hash.update(chunk)
        return {'sha256': output_hash.hexdigest(), 'size': destination.stat().st_size, 'nativeEditsApplied': False}
    except Exception:
        if created: destination.unlink(missing_ok=True)
        raise
