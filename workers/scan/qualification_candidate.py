"""Mechanical, qualification-only scalar patches to a separately packaged job copy.

This module checks immutable source hashes, exact scope/before bytes, caller
evidence declarations and acceptance digests. It DOES NOT interpret the evidence,
qualify native field semantics, prove dependency completeness, operate Eagle or
authorize machine/production use. It never generates proposals. The caller must
use an isolated local export directory, never a live machine job directory.

Request v1 keys: artifactType='scan.qualification-patch-request', schemaVersion='1',
purpose='qualification-only', source={archiveSha256,jobSha256,root,jobMember,
jobRole='main'}, targetEagleBuild=str|null, targetMachine=str|null, reviewer=str,
trialPurpose=str, evidence=[{id,summary,independentSupport:true,references:
[{sha256,label}]}], proposals=[{id,path,identity:{ID,ParentId,MasterKey},before,
after,evidenceIds:[id]}], acceptances=[{proposalId,proposalSha256,decision:
'accepted'|'pending'|'rejected',reviewer}]. A proposal may also declare
dependencyProposalIds; every accepted proposal's dependencies must be accepted.
Unreviewed proposals are not applied. proposal_digest binds source, target, reviewer, purpose,
proposal and its exact evidence. Unknown target identities remain null.

create_qualification_candidate(source, destination, request, cancelled=callable)
atomically publishes one NEW *.scan-qualification.zip outside this checkout.
The wrapper contains CANDIDATE.zip (unchanged tree except accepted leaf bytes),
qualification-receipt.json and README.txt. Its ZIP is transport, not an Eagle
import claim. Empty/no-op patches are rejected. A failed operation returns a
bounded blocked result without publishing a partial output.
"""
from __future__ import annotations

from collections import defaultdict
from copy import copy
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import tempfile
from xml.parsers import expat
import zipfile

from .job_intake import IntakeLimits, _normalize_member_name, inventory_zip
from .snapshot_capture import CaptureBlocked, SnapshotSelection, _fingerprint, _fresh_hash, _publish_no_overwrite, _validate_selection


MAX_ARCHIVE = 100_000_000
MAX_XML = 16_000_000
MAX_CANDIDATE = 1_020_000_000
_PATH = re.compile(r'JobContainer/PartDataList/PartData\[([1-9][0-9]{0,3}|10000)\]/(Roi/cx|CenterPosX|ENABLE|WND_PAD|ListGerPadId1|ListGerbPadId_Common1)\Z')
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_NUMBER = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\Z')
_REQUEST_KEYS = {'artifactType', 'schemaVersion', 'purpose', 'source', 'targetEagleBuild', 'targetMachine', 'reviewer', 'trialPurpose', 'evidence', 'proposals', 'acceptances'}


def _fail(code, message):
    raise CaptureBlocked(code, message)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('ascii')


def _object(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        _fail('INVALID_REQUEST', 'Request fields are missing, unsupported or ambiguous.')


def _text(value, maximum=2048):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and '\0' not in value


def _hash(value):
    return isinstance(value, str) and _HASH.fullmatch(value) is not None


def proposal_digest(request, proposal):
    """Digest exact requested bytes/scope/evidence; this is not an approval."""
    evidence = {item['id']: item for item in request['evidence']}
    bound = {key: request[key] for key in ('purpose', 'source', 'targetEagleBuild', 'targetMachine', 'reviewer', 'trialPurpose')}
    bound.update(artifactType='scan.qualification-proposal', schemaVersion='1', proposal=proposal,
                 evidence=[evidence[key] for key in sorted(proposal['evidenceIds'])])
    return sha256(_canonical(bound)).hexdigest()


def _request(value):
    raw = _canonical(value)
    if len(raw) > 1_000_000:
        _fail('REQUEST_LIMIT', 'Qualification request exceeds its 1 MB bound.')
    value = json.loads(raw)
    _object(value, _REQUEST_KEYS)
    if value['artifactType'] != 'scan.qualification-patch-request' or value['schemaVersion'] != '1' or value['purpose'] != 'qualification-only':
        _fail('INVALID_REQUEST', 'Only the explicit qualification-only request is supported.')
    source = value['source']
    _object(source, {'archiveSha256', 'jobSha256', 'root', 'jobMember', 'jobRole'})
    if not all(_hash(source[key]) for key in ('archiveSha256', 'jobSha256')) or source['jobRole'] != 'main' or not all(_text(source[key], 512) for key in ('root', 'jobMember')):
        _fail('INVALID_SOURCE', 'Exact archive/job hashes and an explicit main snapshot are required.')
    for key in ('targetEagleBuild', 'targetMachine'):
        if value[key] is not None and not _text(value[key], 256):
            _fail('INVALID_REQUEST', 'Target identities must be recorded text or explicitly null.')
    if not _text(value['reviewer'], 256) or not _text(value['trialPurpose'], 2000):
        _fail('APPROVAL_REQUIRED', 'An explicit reviewer and isolated trial purpose are required.')
    evidence = value['evidence']
    if not isinstance(evidence, list) or not 1 <= len(evidence) <= 64:
        _fail('EVIDENCE_REQUIRED', 'Bounded independently supported evidence declarations are required.')
    evidence_ids = set()
    for item in evidence:
        _object(item, {'id', 'summary', 'independentSupport', 'references'})
        if not _text(item['id'], 128) or item['id'] in evidence_ids or not _text(item['summary'], 4000) or item['independentSupport'] is not True:
            _fail('EVIDENCE_REQUIRED', 'Each unique evidence item needs independent support and a summary.')
        evidence_ids.add(item['id'])
        refs = item['references']
        if not isinstance(refs, list) or not 1 <= len(refs) <= 16:
            _fail('EVIDENCE_REQUIRED', 'Each evidence item needs reference hashes.')
        for ref in refs:
            _object(ref, {'sha256', 'label'})
            if not _hash(ref['sha256']) or not _text(ref['label'], 512):
                _fail('EVIDENCE_REQUIRED', 'Evidence reference hashes and labels are required.')
    proposals = value['proposals']
    if not isinstance(proposals, list) or not 1 <= len(proposals) <= 256:
        _fail('PATCH_SET_REQUIRED', 'Supply between one and 256 explicitly accepted scalar patches; empty/no-op output is not generated.')
    ids, paths = set(), set()
    for patch in proposals:
        _object(patch, {'id', 'path', 'identity', 'before', 'after', 'evidenceIds'} | ({'dependencyProposalIds'} if 'dependencyProposalIds' in patch else set()))
        if not _text(patch['id'], 128) or patch['id'] in ids:
            _fail('INVALID_PATCH', 'Proposal IDs must be distinct.')
        ids.add(patch['id'])
        match = _PATH.fullmatch(patch['path']) if isinstance(patch['path'], str) else None
        if not match or patch['path'] in paths:
            _fail('UNSUPPORTED_TARGET', 'Patch targets must be distinct supported scalar paths.')
        paths.add(patch['path'])
        _object(patch['identity'], {'ID', 'ParentId', 'MasterKey'})
        if not all(_text(v) for v in patch['identity'].values()):
            _fail('IDENTITY_REQUIRED', 'Exact part ID, parent/module and Master key are required.')
        if any(not isinstance(patch[key], str) or len(patch[key]) > 2048 or any(c in patch[key] for c in '<&\0') for key in ('before', 'after')) or not patch['after'].strip() or patch['before'] == patch['after']:
            _fail('INVALID_LITERAL', 'Only changed plain scalar text is supported; XML markup/entities and no-op edits are rejected.')
        field = match[2]
        if field == 'ENABLE' and (patch['before'], patch['after']) != ('True', 'False'):
            _fail('UNSUPPORTED_ENABLE', 'The only allowed qualification ENABLE transition is the exact literal True to False.')
        if field in ('Roi/cx', 'CenterPosX') and not _NUMBER.fullmatch(patch['after']):
            _fail('INVALID_LITERAL', 'Coordinate replacement text must use bounded plain decimal syntax.')
        refs = patch['evidenceIds']
        if not isinstance(refs, list) or not 1 <= len(refs) <= 16 or any(not isinstance(k, str) or k not in evidence_ids for k in refs) or len(set(refs)) != len(refs):
            _fail('EVIDENCE_REQUIRED', 'Every proposal must reference distinct supplied evidence.')
    for patch in proposals:
        dependencies = patch.get('dependencyProposalIds', [])
        if not isinstance(dependencies, list) or len(dependencies) > 256 or any(not isinstance(k, str) or k not in ids for k in dependencies) or len(set(dependencies)) != len(dependencies):
            _fail('INVALID_DEPENDENCY', 'Proposal dependencies must be distinct IDs within this exact patch set.')
    accepts = value['acceptances']
    if not isinstance(accepts, list) or len(accepts) > len(proposals):
        _fail('APPROVAL_REQUIRED', 'Provide at most one explicit review decision per proposal.')
    by_id = {}
    for accepted in accepts:
        _object(accepted, {'proposalId', 'proposalSha256', 'decision', 'reviewer'})
        if accepted['proposalId'] not in ids or accepted['proposalId'] in by_id or accepted['decision'] not in ('accepted', 'pending', 'rejected') or accepted['reviewer'] != value['reviewer']:
            _fail('APPROVAL_REQUIRED', 'Review decisions must have one exact proposal and the named reviewer.')
        by_id[accepted['proposalId']] = accepted
    accepted_ids = {key for key, decision in by_id.items() if decision['decision'] == 'accepted'}
    if not accepted_ids:
        _fail('APPROVAL_REQUIRED', 'At least one exact accepted proposal is required; pending, rejected and unreviewed proposals are never applied.')
    for patch in proposals:
        decision = by_id.get(patch['id'])
        if decision and decision['proposalSha256'] != proposal_digest(value, patch):
            _fail('STALE_APPROVAL', 'An accepted digest does not match the exact source, proposal, targets, reviewer and evidence.')
        if patch['id'] in accepted_ids and not set(patch.get('dependencyProposalIds', [])).issubset(accepted_ids):
            _fail('DEPENDENCY_NOT_ACCEPTED', 'An accepted proposal depends on an unaccepted change; its operation is not exported partially.')
    return value


def _xml(raw):
    """Locate original byte spans through a bounded XML parser, not regex matching."""
    if len(raw) > MAX_XML:
        _fail('XML_LIMIT', 'Selected XML exceeds the qualification byte limit.')
    try:
        raw.decode('utf-8-sig')
    except UnicodeError:
        _fail('UNSUPPORTED_ENCODING', 'Only UTF-8 XML is supported for qualification byte patches.')
    parser = expat.ParserCreate()
    stack, leaves, part_paths, ambiguous_ancestors = [], defaultdict(list), [], set()
    nodes = 0
    list_count = 0

    def forbidden(*_):
        _fail('XML_FORBIDDEN', 'DTD, entity declarations and external XML references are unsupported.')

    def declaration(_version, encoding, _standalone):
        if encoding and encoding.lower() not in ('utf-8', 'utf8'):
            _fail('UNSUPPORTED_ENCODING', 'Only UTF-8 XML is supported.')

    def start(name, attributes):
        nonlocal nodes, list_count
        nodes += 1
        if nodes > 250_000 or len(stack) >= 128 or len(name) > 512 or len(attributes) > 64:
            _fail('XML_LIMIT', 'Selected XML exceeds bounded structural limits.')
        # A prefixed declaration alone does not namespace unprefixed elements.
        # Preserve such metadata byte-for-byte, while rejecting native elements
        # that actually use a prefix or inherit a nonempty default namespace.
        if ':' in name or attributes.get('xmlns', ''):
            _fail('UNSUPPORTED_SCHEMA', 'Prefixed native elements and nonempty default namespaces are not supported by this trial writer.')
        parent = stack[-1] if stack else None
        if parent:
            parent['children'] += 1
            parent['counts'][name] += 1
        ordinal = parent['counts'][name] if parent else 1
        path = (parent['path'] + '/' if parent else '') + name
        if path == 'JobContainer/PartDataList':
            list_count += 1
            if list_count != 1:
                _fail('AMBIGUOUS_STRUCTURE', 'Repeated native part collections are unsupported.')
        if path == 'JobContainer/PartDataList/PartData':
            path += f'[{ordinal}]'
            part_paths.append(path)
            if len(part_paths) > 10_000:
                _fail('XML_LIMIT', 'Native part count exceeds the qualification bound.')
        if re.fullmatch(r'JobContainer/PartDataList/PartData\[[0-9]+\]/Roi', path) and ordinal > 1:
            ambiguous_ancestors.add(path)
        offset = parser.CurrentByteIndex
        quoted = None
        end = offset
        while end < len(raw):
            char = raw[end]
            if quoted is not None:
                if char == quoted:
                    quoted = None
            elif char in (34, 39):
                quoted = char
            elif char == 62:
                break
            end += 1
        stack.append({'path': path, 'contentStart': end + 1, 'selfClosing': raw[offset:end].rstrip().endswith(b'/'),
                      'children': 0, 'counts': defaultdict(int), 'attributes': dict(attributes)})

    def end(_name):
        node = stack.pop()
        path = node['path']
        if path == 'JobContainer/JobXmlVersion' or re.fullmatch(r'JobContainer/PartDataList/PartData\[[0-9]+\]/(?:ID|ParentId|MasterKey|Roi/cx|CenterPosX|ENABLE|WND_PAD|ListGerPadId1|ListGerbPadId_Common1)', path):
            start_at, end_at = node['contentStart'], parser.CurrentByteIndex
            scalar = not node['children'] and not node['selfClosing'] and not node['attributes'] and end_at >= start_at
            data = raw[start_at:end_at] if scalar else b''
            if len(data) > 8192:
                _fail('XML_LIMIT', 'A target or identity scalar exceeds its bounded size.')
            leaves[path].append({'start': start_at, 'end': end_at, 'plain': scalar and b'<' not in data and b'&' not in data,
                                 'literal': data.decode('utf-8') if scalar else None})

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.XmlDeclHandler = declaration
    parser.StartDoctypeDeclHandler = forbidden
    parser.EntityDeclHandler = forbidden
    parser.ExternalEntityRefHandler = forbidden
    try:
        parser.Parse(raw, True)
    except expat.ExpatError:
        _fail('XML_INVALID', 'Selected XML is malformed; no candidate was published.')
    version = leaves.get('JobContainer/JobXmlVersion', [])
    if len(version) != 1 or not version[0]['plain'] or version[0]['literal'] != '10.2':
        _fail('UNSUPPORTED_SCHEMA', 'One exact JobXmlVersion 10.2 scalar is required; this does not identify an Eagle application build.')
    return leaves, part_paths, ambiguous_ancestors


def _patch_xml(raw, patches):
    leaves, parts, ambiguous_ancestors = _xml(raw)
    identities = defaultdict(list)
    identity_literals = {key: defaultdict(set) for key in ('ID', 'ParentId', 'MasterKey')}
    for part in parts:
        values = [leaves.get(part + '/' + key, []) for key in ('ID', 'ParentId', 'MasterKey')]
        for key, field_values in zip(identity_literals, values):
            for value in field_values:
                if value['plain']:
                    identity_literals[key][value['literal']].add(part)
        if all(len(v) == 1 and v[0]['plain'] for v in values):
            identities[tuple(v[0]['literal'] for v in values)].append(part)
    spans = []
    for patch in patches:
        part = patch['path'].split(']/', 1)[0] + ']'
        if patch['path'].endswith('/Roi/cx') and part + '/Roi' in ambiguous_ancestors:
            _fail('AMBIGUOUS_TARGET', 'The selected ROI scalar has repeated owning containers.')
        expected = tuple(patch['identity'][key] for key in ('ID', 'ParentId', 'MasterKey'))
        possible = set.intersection(*(identity_literals[key].get(patch['identity'][key], set()) for key in identity_literals))
        if identities.get(expected) != [part] or possible != {part}:
            _fail('IDENTITY_MISMATCH', 'The exact part identity does not resolve uniquely to the reviewed ordinal.')
        target = leaves.get(patch['path'], [])
        if len(target) != 1 or not target[0]['plain']:
            _fail('AMBIGUOUS_TARGET', 'A target is missing, repeated, nested, attributed or not plain scalar text.')
        target = target[0]
        if target['literal'] != patch['before']:
            _fail('STALE_BEFORE', 'A target literal no longer matches its exact accepted before value.')
        spans.append((target['start'], target['end'], patch['after'].encode('utf-8')))
    spans.sort()
    last, pieces = 0, []
    for start, end, after in spans:
        if start < last:
            _fail('OVERLAPPING_TARGETS', 'Patch byte spans overlap.')
        pieces.extend((raw[last:start], after))
        last = end
    pieces.append(raw[last:])
    changed = b''.join(pieces)
    after_leaves, after_parts, after_ambiguous = _xml(changed)
    if parts != after_parts or ambiguous_ancestors != after_ambiguous:
        _fail('INVARIANT_FAILED', 'Native part structure changed during patching.')
    by_path = {patch['path']: patch['after'] for patch in patches}
    if set(leaves) != set(after_leaves):
        _fail('INVARIANT_FAILED', 'Observed scalar paths changed during patching.')
    for path, before in leaves.items():
        expected = [by_path[path]] if path in by_path else [value['literal'] for value in before]
        if expected != [value['literal'] for value in after_leaves[path]]:
            _fail('INVARIANT_FAILED', 'A scalar outside the accepted changes differed after patching.')
    # The only byte construction is unchanged slices plus the exact accepted
    # replacements. No XML serializer can reorder or discard unknown content.
    return changed


def _check(cancelled):
    if cancelled is not None and cancelled():
        _fail('CANCELLED', 'Qualification trial creation was cancelled; no candidate was published.')


def _copy_stream(incoming, outgoing, maximum, cancelled):
    digest, size = sha256(), 0
    while True:
        _check(cancelled)
        chunk = incoming.read(min(1024 * 1024, maximum - size + 1))
        if not chunk:
            break
        size += len(chunk)
        if size > maximum:
            _fail('SIZE_LIMIT', 'An archive payload exceeds its configured bound.')
        digest.update(chunk)
        if outgoing is not None:
            outgoing.write(chunk)
    return digest.hexdigest(), size


def create_qualification_candidate(source_path, destination_path, request, *, cancelled=None):
    """Publish an isolated transport package, never a live native job directory.

    Evidence support is a caller declaration bound to the exact acceptance, not
    a semantic finding of this function. Every successful receipt retains
    machineExportAllowed=False and machineCompatibility=None.
    """
    published = False
    result = None
    try:
        request = _request(request)
        _check(cancelled)
        source = Path(source_path).absolute()
        destination = Path(destination_path).absolute()
        parent = destination.parent.resolve(strict=True)
        repository = Path(__file__).resolve().parents[2]
        if not parent.is_dir() or parent.is_relative_to(repository) or str(parent).startswith(('\\\\', '//')) or not destination.name.endswith('.scan-qualification.zip'):
            _fail('DESTINATION_POLICY', 'Use an existing local isolated export directory outside this checkout and a new .scan-qualification.zip filename.')
        destination = parent / destination.name
        if os.path.lexists(destination):
            _fail('DESTINATION_EXISTS', 'Qualification output never overwrites an existing file.')
        expected = request['source']
        decisions = {item['proposalId']: item['decision'] for item in request['acceptances']}
        approved_proposals = [item for item in request['proposals'] if decisions.get(item['id']) == 'accepted']
        original_hash, original_stat = _fresh_hash(source, MAX_ARCHIVE)
        if original_hash != expected['archiveSha256']:
            _fail('STALE_SOURCE', 'The original archive differs from the accepted source hash.')
        with tempfile.TemporaryDirectory(prefix='.scan-qualification-', dir=parent) as temporary:
            stage = Path(temporary).resolve()
            if stage.parent != parent:
                _fail('DESTINATION_POLICY', 'Qualification staging is outside its expected directory.')
            frozen = stage / 'source.zip'
            with source.open('rb') as incoming, frozen.open('xb') as outgoing:
                copied_hash, copied_size = _copy_stream(incoming, outgoing, MAX_ARCHIVE, cancelled)
            if copied_hash != original_hash or copied_size != original_stat.st_size:
                _fail('SOURCE_CHANGED', 'The source changed while its private copy was captured.')
            limits = IntakeLimits()
            inventory = inventory_zip(frozen, limits)
            _validate_selection(inventory, SnapshotSelection(expected['root'], expected['jobMember'], 'main'))
            entries = {entry.path: entry for entry in inventory.entries}
            candidate = stage / 'candidate.zip'
            before_files, after_files, selected_count, total = {}, {}, 0, 0
            with zipfile.ZipFile(frozen) as original, zipfile.ZipFile(candidate, 'x') as output:
                output.comment = original.comment
                for info in original.infolist():
                    _check(cancelled)
                    member = _normalize_member_name(info.filename, limits.max_path_length)
                    entry = entries[member]
                    if entry.is_directory:
                        if info.file_size:
                            _fail('INVALID_ARCHIVE', 'Directory entries must have empty payloads.')
                        output.writestr(copy(info), b'')
                        before_files[info.filename] = after_files[info.filename] = {'sha256': sha256(b'').hexdigest(), 'size': 0, 'directory': True}
                        continue
                    budget = min(limits.max_entry_uncompressed, limits.max_total_uncompressed - total)
                    with original.open(info) as incoming:
                        if member == expected['jobMember']:
                            selected_count += 1
                            raw = incoming.read(min(MAX_XML, budget) + 1)
                            if len(raw) > min(MAX_XML, budget) or incoming.read(1):
                                _fail('XML_LIMIT', 'Selected XML exceeds the bounded qualification reader.')
                            before_hash = sha256(raw).hexdigest()
                            if before_hash != expected['jobSha256']:
                                _fail('STALE_JOB', 'Selected job bytes differ from the accepted job hash.')
                            changed = _patch_xml(raw, approved_proposals)
                            output.writestr(copy(info), changed)
                            before_files[info.filename] = {'sha256': before_hash, 'size': len(raw), 'directory': False}
                            after_files[info.filename] = {'sha256': sha256(changed).hexdigest(), 'size': len(changed), 'directory': False}
                            size = len(raw)
                        else:
                            with output.open(copy(info), 'w') as outgoing:
                                digest, size = _copy_stream(incoming, outgoing, budget, cancelled)
                            before_files[info.filename] = after_files[info.filename] = {'sha256': digest, 'size': size, 'directory': False}
                    if size != entry.size:
                        _fail('INVALID_ARCHIVE', 'Actual member size differs from its bounded inventory.')
                    total += size
            if selected_count != 1:
                _fail('INVALID_SELECTION', 'The selected main XML did not resolve exactly once.')
            candidate_hash, _ = _fresh_hash(candidate, MAX_CANDIDATE)
            with zipfile.ZipFile(candidate) as verified:
                if [info.filename for info in verified.infolist()] != list(before_files):
                    _fail('INVARIANT_FAILED', 'Candidate member names/order changed.')
                for info in verified.infolist():
                    with verified.open(info) as incoming:
                        digest, size = _copy_stream(incoming, None, limits.max_entry_uncompressed + MAX_XML, cancelled)
                    if (digest, size) != (after_files[info.filename]['sha256'], after_files[info.filename]['size']):
                        _fail('INVARIANT_FAILED', 'Candidate payload did not match the verified changed/unchanged bytes.')
            receipt = {
                'artifactType': 'scan.qualification-trial-receipt', 'schemaVersion': '1', 'status': 'success',
                'writerVersion': 'qualification-byte-patch-1', 'nativeSchemaClaim': 'JobContainer/10.2',
                'qualificationOnly': True, 'nativeEditsApplied': True, 'machineExportAllowed': False,
                'nativeSemanticsQualified': False, 'machineCompatibility': None, 'productionRelease': None,
                'dependencyCompleteness': None,
                'source': expected, 'targetEagleBuild': request['targetEagleBuild'], 'targetMachine': request['targetMachine'],
                'targetIdentityVerified': False, 'reviewer': request['reviewer'], 'trialPurpose': request['trialPurpose'],
                'evidenceInterpretation': 'Caller-asserted independent support; bound mechanically, not interpreted or qualified by this writer.',
                'evidence': request['evidence'], 'changes': approved_proposals, 'acceptances': request['acceptances'],
                'unappliedProposals': [{'id': item['id'], 'decision': decisions.get(item['id'], 'unreviewed'),
                                       'proposalSha256': proposal_digest(request, item)} for item in request['proposals'] if decisions.get(item['id']) != 'accepted'],
                'candidate': {'path': 'CANDIDATE.zip', 'sha256': candidate_hash, 'size': candidate.stat().st_size},
                'files': [{'path': name, 'before': before_files[name], 'after': after_files[name]} for name in before_files],
            }
            receipt_bytes = _canonical(receipt)
            if len(receipt_bytes) > 3_000_000:
                _fail('RECEIPT_LIMIT', 'Qualification evidence receipt exceeds its 3 MB bound.')
            package = stage / 'trial.scan-qualification.zip'
            with zipfile.ZipFile(package, 'x', compression=zipfile.ZIP_STORED) as wrapper:
                wrapper.write(candidate, 'CANDIDATE.zip')
                wrapper.writestr('qualification-receipt.json', receipt_bytes)
                wrapper.writestr('README.txt', 'ISOLATED QUALIFICATION TRIAL ONLY\nCANDIDATE.zip contains native scalar edits explicitly accepted by the named reviewer.\nThis transport ZIP is not an Eagle import claim. Do not overwrite a live job or library.\nNative semantics, required dependencies and Eagle open/save/reopen compatibility remain unqualified.\nVerify the exact candidate in a separate authorized Eagle trial and preserve the original.\n')
            package_hash, package_stat = _fresh_hash(package, MAX_CANDIDATE + 4_000_000)
            fresh_hash, fresh_stat = _fresh_hash(source, MAX_ARCHIVE)
            if fresh_hash != original_hash or _fingerprint(fresh_stat) != _fingerprint(original_stat):
                _fail('SOURCE_CHANGED', 'The original changed before publication; no qualification output was published.')
            _check(cancelled)
            result = {**receipt, 'packageSha256': package_hash, 'packageSize': package_stat.st_size}
            _publish_no_overwrite(package, destination)
            published = True
            return result
    except CaptureBlocked as error:
        if published:
            return {**result, 'cleanupWarning': 'The complete qualification package was published, but its owned staging directory could not be fully removed.'}
        return {'status': 'blocked', 'code': error.code, 'reason': str(error), 'machineExportAllowed': False, 'qualificationOnly': True, 'nativeEditsApplied': False}
    except Exception:
        if published:
            return {**result, 'cleanupWarning': 'The complete qualification package was published, but its owned staging directory could not be fully removed.'}
        return {'status': 'blocked', 'code': 'QUALIFICATION_FAILED', 'reason': 'Qualification creation failed; no incomplete output was published. Check source structure, destination and request without changing the original.', 'machineExportAllowed': False, 'qualificationOnly': True, 'nativeEditsApplied': False}
