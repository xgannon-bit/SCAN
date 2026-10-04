"""Bounded local worker for Gerber parsing and rigid registration."""
import json
from pathlib import Path
import sys
from .gerber_rs274x import parse_gerber, GerberLimits


def main():
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384: raise ValueError('Geometry settings exceed their size limit')
        request = json.loads(raw)
        if not isinstance(request, dict) or set(request) != {'protocolVersion', 'source', 'action', 'config'} or request['protocolVersion'] != '1':
            raise ValueError('Invalid geometry request')
        source = Path(request['source'])
        if request['action'] == 'gerber':
            config = request['config']
            if not isinstance(config, dict) or set(config) != {'formatOverride', 'assumeLinear'}:
                raise ValueError('Invalid Gerber settings')
            result = parse_gerber(source, GerberLimits(max_source_bytes=8_000_000), format_override=config['formatOverride'], assume_linear=config['assumeLinear']).to_dict()
        elif request['action'] == 'align':
            from .alignment import align
            if request['config'] != {} or source.stat().st_size > 32000: raise ValueError('Invalid alignment settings')
            result = align(json.loads(source.read_bytes()))
        else: raise ValueError('Unknown geometry action')
    except ValueError as exc:
        result = {'status': 'blocked', 'message': str(exc)}
    except Exception:
        result = {'status': 'blocked', 'message': 'Geometry worker could not process this input. No original was changed.'}
    print(json.dumps({'protocolVersion': '1', 'result': result}, allow_nan=False))


if __name__ == '__main__': main()
