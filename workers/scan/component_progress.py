"""Opt-in local browser telemetry. No request/approval/geometry is read from it."""
import json
import os
import sys


def component_checked(kind, identity, before, after):
    if os.environ.get('SCAN_COMPONENT_PROGRESS') != '1':
        return
    def roi(value):
        return {key: float(value[native]) for key, native in (
            ('x', 'cx'), ('y', 'cy'), ('width', 'w'), ('height', 'h'), ('angle', 'a'))}
    try:
        event = {'kind': kind, 'geometry': {'frame': 'native-roi-unqualified',
            'identity': {'module': identity['ParentId'], 'ref': identity['RefID'], 'id': identity['ID'], 'master': identity['MasterKey']},
            'before': roi(before) if before else None, 'after': roi(after)}}
        payload = json.dumps(event, ensure_ascii=True, allow_nan=False)
        if len(payload) <= 8000:
            sys.stderr.write('SCAN_COMPONENT_V1 ' + payload + '\n')
            sys.stderr.flush()
    except (ValueError, KeyError, TypeError, OSError):
        # Display telemetry cannot alter the engineering result.
        pass
