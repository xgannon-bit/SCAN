"""Bounded read-only FOV assignment inventory; assignment is never coverage.

Saved camera IDs, path IDs and assignment literals remain separate observations.
No nearest-center heuristic, pixel calibration or qualified FOV writer is supplied.
"""
from hashlib import sha256
from collections import defaultdict, Counter
import json
import re
from xml.etree import ElementTree as ET

from .qualification_candidate import _xml
from .snapshot_capture import CaptureBlocked


def fov_assignments(job, source_context):
    result = {'artifactType': 'scan.native-fov-assignments', 'schemaVersion': '1',
              'status': 'unavailable', 'assignments': [], 'cameraRecords': [], 'counts': None,
              'nativeAssignmentWritten': False, 'coverageQualified': False,
              'limitations': ['An assignment literal does not prove camera ID/index semantics, enabled traversal or image-channel availability.',
                  'Camera Id and PathId are separate observed domains. Conflicting candidate centers and Enb/ENABLE literals remain unresolved; neither domain is silently chosen.',
                  'Body, search and terminal-window coverage require calibrated usable acquisition extents, margins and qualified native transforms.',
                  'Nearest saved camera center is an assignment heuristic only; no FOV or binding fields are written.']}
    try:
        context = json.loads(json.dumps(source_context, allow_nan=False))
        if len(json.dumps(context)) > 16000 or sha256(job).hexdigest() != context['selection']['job']['sha256']:
            raise ValueError('context')
        _xml(job, supported_versions=('10.1', '10.2'))  # Read-only opt-in; constructors keep the 10.2 default.
        root = ET.fromstring(job)
        assignments = []
        def literals(node, field):
            values = node.findall(field)
            if len(values) > 64 or any(len(n) or n.attrib or len(n.text or '') > 2048 for n in values):
                raise ValueError('literal')
            return [n.text or '' for n in values]
        for ordinal, part in enumerate(root.findall('PartDataList/PartData'), 1):
            nodes = part.findall('FovList')
            values = []
            state = 'unresolved'
            if len(nodes) == 1 and not nodes[0].attrib and not (nodes[0].text or '').strip() and len(nodes[0]) <= 256:
                node = nodes[0]
                if not len(node):
                    state = 'empty'
                elif len({child.tag for child in node}) == len(node) and all(re.fullmatch(r'Fov[0-9]{1,4}', child.tag) and not len(child) and not child.attrib
                         and bool((child.text or '').strip()) and len(child.text or '') <= 2048
                         and not (child.tail or '').strip() for child in node):
                    values = [{'field': child.tag, 'value': child.text} for child in node]
                    state = 'literal-assignment-present'
            identity = {key: literals(part, key) for key in ('ID', 'ParentId', 'RefID', 'MasterKey')}
            if any(len(v) != 1 or not v[0] for v in identity.values()):
                state = 'unresolved'
            assignments.append({'sourcePath': f'JobContainer/PartDataList/PartData[{ordinal}]',
                'identity': identity, 'assignmentState': state, 'assignedLiterals': values,
                'coverage': 'unverified', 'nativeIdMeaning': 'unqualified', 'enabledExecution': 'unverified'})
        cameras = []
        if len(root.findall('FovSetInfo')) > 1:
            raise ValueError('fov collection')
        for fov_ordinal, fov in enumerate(root.findall('FovSetInfo/Fov'), 1):
            for ordinal, node in enumerate(fov.findall('FovInfo'), 1):
                if len(cameras) >= 10000:
                    raise ValueError('camera limit')
                cameras.append({'sourcePath': f'JobContainer/FovSetInfo/Fov[{fov_ordinal}]/FovInfo[{ordinal}]',
                    'rawFields': {key: literals(node, key) for key in ('Id', 'C', 'PathId', 'CtnMdID', 'Enb', 'ENABLE')},
                    'coordinateFrame': 'unqualified', 'usableAcquisitionArea': 'unknown'})
        domains = {field: defaultdict(list) for field in ('Id', 'PathId')}
        for camera in cameras:
            fields = camera['rawFields']
            observation = {'sourcePath': camera['sourcePath'], 'centerLiterals': fields['C'],
                'moduleLiterals': fields['CtnMdID'], 'enableLiterals': fields['Enb'],
                'legacyEnableLiterals': fields['ENABLE'],
                'domainLiteralState': 'unique-plain-literals' if len(fields['Id']) == len(fields['PathId']) == 1 else 'missing-or-repeated-literals'}
            for field in domains:
                # Every observed identity is retained. A repeated scalar cannot
                # be silently discarded to manufacture a unique candidate.
                for value in dict.fromkeys(fields[field]):
                    domains[field][value].append(observation)
        states = Counter()
        for assignment in assignments:
            candidates = []
            for literal in assignment['assignedLiterals']:
                ids = domains['Id'].get(literal['value'], [])
                paths = domains['PathId'].get(literal['value'], [])
                if len(ids) > 64 or len(paths) > 64:
                    raise ValueError('camera candidate limit')
                if len(ids) > 1 or len(paths) > 1 or any(c['domainLiteralState'] != 'unique-plain-literals' for c in ids+paths):
                    state = 'ambiguous-repeated-domain-literal'
                elif ids and paths:
                    state = 'same-record-in-both-observed-domains' if ids[0]['sourcePath'] == paths[0]['sourcePath'] else 'conflicting-domain-candidates'
                elif ids:
                    state = 'id-literal-only-candidate'
                elif paths:
                    state = 'path-id-literal-only-candidate'
                else:
                    state = 'no-literal-domain-candidate'
                states[state] += 1
                candidates.append({**literal, 'idMatches': ids, 'pathIdMatches': paths, 'state': state,
                    'chosenDomain': None, 'coverage': 'unverified'})
            assignment['cameraDomainCandidates'] = candidates
        result['domainReviewCounts'] = dict(states)
        result['requiredEvidence'] = [
            'One isolated before/after native job with a known placement-to-camera assignment, exact Eagle build/schema and machine identity, resolving whether FovList refers to Id, PathId or another domain.',
            'A separate observed camera enable/traversal example resolving Enb and any legacy ENABLE field; saved Boolean text is not execution proof.',
            'Usable acquisition extents, pixel calibration, channels, margins and source/module/image frames before any body or inspection-window coverage claim.']
        result.update(status='recorded', sourceContext=context, assignments=assignments, cameraRecords=cameras,
            counts={'placements': len(assignments), 'empty': sum(r['assignmentState'] == 'empty' for r in assignments),
                'assigned': sum(r['assignmentState'] == 'literal-assignment-present' for r in assignments),
                'unresolved': sum(r['assignmentState'] == 'unresolved' for r in assignments),
                'cameraRecords': len(cameras), 'coverageVerified': 0})
        if len(json.dumps(result, ensure_ascii=True).encode()) > 2_000_000:
            raise ValueError('output limit')
        return result
    except (CaptureBlocked, ValueError, KeyError, TypeError, ET.ParseError):
        result.update(status='unavailable', assignments=[], cameraRecords=[], counts=None,
                      reason='FOV assignment observations require supported bounded selected XML and an exact source hash; no partial coverage claim is made.')
        result.pop('sourceContext', None)
        result.pop('domainReviewCounts', None)
        return result
