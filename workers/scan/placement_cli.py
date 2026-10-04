"""Bounded JSON control request; source bytes stay in the local runtime."""
import json
from pathlib import Path
import sys
import warnings
from hashlib import sha256

from .placement_intake import IntakeError, MAX_BYTES, inspect_table, normalize, read_table
from .snapshot_capture import _fresh_hash


def main():
    try:
        request_bytes = sys.stdin.buffer.read(16_385)
        if len(request_bytes) > 16_384: raise IntakeError('Request exceeds 16 KiB.')
        request = json.loads(request_bytes.decode('utf-8'))
        fields = {'protocolVersion', 'action', 'source', 'format', 'sheetIndex', 'delimiter', 'config'}
        if not isinstance(request, dict) or set(request) != fields or request['protocolVersion'] != '1' or request['action'] not in ('inspect', 'normalize'):
            raise IntakeError('Invalid placement worker request.')
        if not isinstance(request['source'], str) or not Path(request['source']).is_absolute():
            raise IntakeError('Source must be an absolute local file path.')
        source = Path(request['source'])
        expected, _ = _fresh_hash(source, MAX_BYTES)
        with source.open('rb') as handle: data = handle.read(MAX_BYTES + 1)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')  # Vendor cell values must never reach logs.
            table = read_table(data, request['format'], request['sheetIndex'], request['delimiter'])
            result = inspect_table(table, data) if request['action'] == 'inspect' else normalize(table, data, request['config'])
        if expected != result['sourceSha256'] or _fresh_hash(source, MAX_BYTES)[0] != expected:
            raise IntakeError('Source changed during reading. Select it again.')
        if request['action'] == 'normalize':
            result['normalizerVersion'] = 'placement-2'
            result['delimiter'] = request['delimiter']
            result['interpretationSha256'] = sha256(json.dumps(result, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()
    except IntakeError as error:
        result = {'status': 'blocked', 'message': str(error), 'machineExportAllowed': False}
    except Exception:
        result = {'status': 'blocked', 'message': 'File or request is malformed, unsupported, or inaccessible. No source contents were logged.', 'machineExportAllowed': False}
    sys.stdout.write(json.dumps({'protocolVersion': '1', 'result': result}, ensure_ascii=True) + '\n')
    return 0 if result['status'] == 'success' else 2


if __name__ == '__main__':
    raise SystemExit(main())
