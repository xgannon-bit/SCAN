"""Bounded local, read-only source-body evidence protocol."""
import json
from pathlib import Path
import sys
import warnings

from .bom_intake import normalize_bom
from .origin_evidence import body_evidence
from .placement_intake import MAX_BYTES, IntakeError, read_table
from .snapshot_capture import CaptureBlocked, _fresh_hash


def main():
    try:
        raw = sys.stdin.buffer.read(250_001)
        if len(raw) > 250_000:
            raise IntakeError('Origin evidence request exceeds 250 KB.')
        request = json.loads(raw.decode('utf-8'))
        required = {'protocolVersion', 'source', 'bomSource', 'bomKind', 'bomSheetIndex', 'bomDelimiter', 'bomConfig', 'packageProfiles'}
        if not isinstance(request, dict) or set(request) != required or request['protocolVersion'] != '1':
            raise IntakeError('Invalid origin evidence request.')
        source, bom_path = Path(request['source']), Path(request['bomSource'])
        if not source.is_absolute() or not bom_path.is_absolute() or source.parent != bom_path.parent or source == bom_path:
            raise IntakeError('Source and BOM must be distinct local captured files in one directory.')
        if request['bomKind'] not in {'xlsx', 'xls', 'csv'} or type(request['bomSheetIndex']) is not int or not 0 <= request['bomSheetIndex'] < 20 or request['bomDelimiter'] not in {',', ';', '\t'}:
            raise IntakeError('Invalid BOM source format.')
        before = [_fresh_hash(p, MAX_BYTES)[0] for p in (source, bom_path)]
        pcb, raw_bom = [p.read_bytes() for p in (source, bom_path)]
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            bom = normalize_bom(read_table(raw_bom, request['bomKind'], request['bomSheetIndex'], request['bomDelimiter']), raw_bom, request['bomConfig'])
            result = body_evidence(pcb, request['packageProfiles'], bom)
        if before != [result['layoutSha256'], result['bomSha256']] or before != [_fresh_hash(p, MAX_BYTES)[0] for p in (source, bom_path)]:
            raise IntakeError('Source changed during origin evidence reading.')
        if len(json.dumps(result)) > 4_000_000:
            raise IntakeError('Origin evidence exceeds 4 MB.')
    except (IntakeError, CaptureBlocked) as error:
        result = {'status': 'blocked', 'message': str(error), 'nativeEditsApplied': False}
    except Exception:
        result = {'status': 'blocked', 'message': 'Source/body evidence is malformed or unsupported. No source contents were logged.', 'nativeEditsApplied': False}
    sys.stdout.write(json.dumps({'protocolVersion': '1', 'result': result}, ensure_ascii=True, allow_nan=False)+'\n')
    return 0 if result['status'] == 'success' else 2


if __name__ == '__main__':
    raise SystemExit(main())
