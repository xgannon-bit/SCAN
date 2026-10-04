"""Browser host adapter: source paths belong to its bounded local subprocess host."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

from .worker_cli import dispatch as core_dispatch, MAX_REQUEST_BYTES


def blocked(code, reason):
    return {'status': 'blocked', 'code': code, 'reasons': [reason], 'machineExportAllowed': False}


def dispatch(request):
    if not isinstance(request, dict) or request.get('protocolVersion') != '1':
        return blocked('INVALID_REQUEST', 'Expected browser worker protocol 1.')
    action = request.get('action')
    fields = {'inventory': {'protocolVersion', 'action', 'source'},
              'preflight': {'protocolVersion', 'action', 'source', 'expectedArchiveSha256', 'selection'},
              'download': {'protocolVersion', 'action', 'source', 'expectedArchiveSha256', 'selection', 'expectedPackageSha256'}}
    if not isinstance(action, str) or action not in fields or set(request) != fields[action]:
        return blocked('INVALID_REQUEST', 'Unexpected browser worker fields.')
    source = request.get('source')
    if not isinstance(source, str) or not Path(source).is_absolute():
        return blocked('INVALID_REQUEST', 'The local host must supply an absolute source path.')
    if action == 'inventory':
        return core_dispatch({'protocolVersion': '1', 'action': 'inventory', 'source': source})
    expected_package = request.get('expectedPackageSha256')
    if action == 'download' and (not isinstance(expected_package, str) or not re.fullmatch(r'[a-f0-9]{64}', expected_package)):
        return blocked('INVALID_REQUEST', 'A previously verified capture hash is required for download.')
    destination = Path(source).parent / 'result.scan-snapshot'
    capture = core_dispatch({'protocolVersion': '1', 'action': 'capture', 'source': source, 'destination': str(destination),
                             'expectedArchiveSha256': request['expectedArchiveSha256'], 'selection': request['selection']})
    if capture['status'] != 'success':
        return capture
    # The original capture receipt is the independent trust input, never a newly
    # calculated hash of a potentially modified snapshot.
    report = core_dispatch({'protocolVersion': '1', 'action': 'inspect-snapshot', 'source': str(destination),
                            'expectedPackageSha256': capture['package_sha256']})
    if report['status'] != 'success':
        return report
    if action == 'download' and capture['package_sha256'] != expected_package:
        return blocked('CAPTURE_CHANGED', 'Recreated snapshot differs from the reviewed capture. Run preflight again.')
    return {'status': 'success', 'code': 'ARCHIVE_PREFLIGHT_RECORDED', 'artifactType': 'scan.archive-review', 'schemaVersion': '1',
            'capture': {'snapshotId': capture['snapshot_id'], 'packageSha256': capture['package_sha256'], 'size': destination.stat().st_size},
            'preflight': report, 'machineExportAllowed': False, 'candidateId': None}


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            result = blocked('REQUEST_TOO_LARGE', 'Browser worker request exceeds its limit.')
        else:
            result = dispatch(json.loads(raw.decode('utf-8')))
    except Exception:
        result = blocked('WORKER_ERROR', 'Archive request could not be completed. No source contents were logged.')
    sys.stdout.buffer.write((json.dumps({'protocolVersion': '1', 'result': result}, ensure_ascii=True) + '\n').encode())
    return {'success': 0, 'blocked': 2, 'unsupported': 3}.get(result['status'], 2)


if __name__ == '__main__':
    raise SystemExit(main())
