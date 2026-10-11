"""Bounded JobContainer collection edits, with exact byte rollback.

This supplies serialization mechanics only. Callers must freshly derive and
approve every record, validate identities and dependencies, and keep new work
disabled. Expanding an empty collection does not supply a missing native seed.
"""
from dataclasses import dataclass
from xml.etree import ElementTree as ET
from xml.parsers import expat

from .qualification_candidate import _xml, _fail, MAX_XML


COLLECTIONS = {'JobContainer/PartDataList': 'PartData',
               'JobContainer/WindowDataList': 'WindowData'}


@dataclass(frozen=True)
class Collection:
    path: str
    start: int
    opening_end: int
    insertion_point: int
    self_closing: bool
    record_count: int


def collection_layout(raw, paths):
    """Find exact supported collections without serializing any original XML."""
    _xml(raw)
    paths = tuple(paths)
    if len(set(paths)) != len(paths) or any(path not in COLLECTIONS for path in paths):
        _fail('DRAFT_CONTAINER', 'Only exact native PartDataList and WindowDataList collection paths are supported.')
    parser = expat.ParserCreate()
    stack, targets = [], {}

    def start(tag, attrs):
        path = '/'.join([node['tag'] for node in stack] + [tag])
        if stack and stack[-1]['path'] in paths:
            parent = stack[-1]
            if tag != COLLECTIONS[parent['path']]:
                _fail('DRAFT_CONTAINER_SCHEMA', 'An unknown direct collection record cannot be interpreted as a supported insertion target.')
            parent['count'] += 1
        node = {'tag': tag, 'path': path, 'count': 0}
        if path in paths:
            if path in targets or attrs:
                _fail('DRAFT_CONTAINER', 'Insertion requires one unambiguous native collection without unqualified collection attributes.')
            point = parser.CurrentByteIndex
            end = raw.find(b'>', point)
            if end < point:
                _fail('DRAFT_CONTAINER', 'The exact native collection opening delimiter is unavailable.')
            node.update(start=point, opening_end=end+1, self_closing=raw[point:end].rstrip().endswith(b'/'))
            targets[path] = None
        stack.append(node)

    def text(value):
        if stack and stack[-1]['path'] in paths and value.strip():
            _fail('DRAFT_CONTAINER_SCHEMA', 'Mixed collection text cannot be interpreted as a supported record list.')

    def end(_tag):
        node = stack.pop()
        if node['path'] in paths:
            point = parser.CurrentByteIndex
            if not node['self_closing'] and not raw[point:].startswith(b'</'):
                _fail('DRAFT_CONTAINER', 'The exact native collection closing delimiter is unavailable.')
            targets[node['path']] = Collection(node['path'], node['start'], node['opening_end'],
                                               point, node['self_closing'], node['count'])

    parser.StartElementHandler = start
    parser.CharacterDataHandler = text
    parser.EndElementHandler = end
    parser.Parse(raw, True)
    if set(targets) != set(paths):
        _fail('DRAFT_CONTAINER', 'A required native record collection is missing; SCAN does not invent its document location.')
    return targets


def append_records(raw, insertions):
    """Append freshly derived records and return reversible, exact byte edits.

    Self-closing expansion changes only the selected opening delimiter and adds
    its matching closing delimiter plus approved records. Explicit collections
    receive insertions immediately before their original closing tag.
    """
    targets = collection_layout(raw, tuple(insertions))
    edits = []
    for path, records in insertions.items():
        if not isinstance(records, list) or len(records) > 10_000:
            _fail('DRAFT_INSERTION', 'A bounded list of freshly derived record bytes is required.')
        if not records:
            continue
        if any(not isinstance(record, bytes) for record in records) or sum(map(len, records)) > MAX_XML:
            _fail('DRAFT_INSERTION', 'Combined prepared records exceed the native document byte bound.')
        for raw_record in records:
            if not isinstance(raw_record, bytes) or not raw_record or len(raw_record) > 1_000_000:
                _fail('DRAFT_INSERTION', 'A bounded nonempty native record is required.')
            if b'<!DOCTYPE' in raw_record or b'<!ENTITY' in raw_record:
                _fail('DRAFT_INSERTION', 'Entity and DTD declarations are not native prepared records.')
            try:
                record = ET.fromstring(raw_record)
            except ET.ParseError:
                _fail('DRAFT_INSERTION', 'A prepared record must be one well-formed native element.')
            if record.tag != COLLECTIONS[path] or record.tail:
                _fail('DRAFT_INSERTION', 'Prepared record kind differs from its exact native collection.')
        target = targets[path]
        payload = b''.join(records)
        if target.self_closing:
            start, end = target.start, target.opening_end
            before = raw[start:end]
            # The XML parser has established an attribute-free empty element.
            # Keep all other original opening-tag bytes, including whitespace.
            slash = before.rfind(b'/')
            after = before[:slash] + before[slash+1:] + payload + b'</' + path.split('/')[-1].encode() + b'>'
        else:
            start = end = target.insertion_point
            before, after = b'', payload
        edits.append({'start': start, 'end': end, 'before': before, 'after': after})
    current, offset, receipts = raw, 0, []
    for edit in sorted(edits, key=lambda item: item['start']):
        receipts.append({**edit, 'start': edit['start'] + offset, 'end': edit['start'] + offset + len(edit['after'])})
        offset += len(edit['after']) - len(edit['before'])
    for edit in sorted(edits, key=lambda item: item['start'], reverse=True):
        current = current[:edit['start']] + edit['after'] + current[edit['end']:]
    _xml(current)
    if rollback_records(current, receipts) != raw:
        _fail('DRAFT_PRESERVATION', 'Exact insertion rollback did not recover the original native document.')
    return current, receipts


def rollback_records(current, receipts):
    """Recover original bytes only while every recorded replacement still matches."""
    for edit in reversed(receipts):
        start, end = edit['start'], edit['end']
        if current[start:end] != edit['after']:
            _fail('DRAFT_ROLLBACK', 'A changed insertion cannot be silently removed as the reviewed original edit.')
        current = current[:start] + edit['before'] + current[end:]
    return current
