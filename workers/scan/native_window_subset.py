"""Select a closed subset of an already schema-validated native window set.

The caller must first validate every window's supported field schema, rectangle,
polygon policy, local identity and group format, plus its placement/Master frame.
This function checks known ParentWndId/AlignWndID relationships only. It does not
establish vendor semantics, sufficient inspection coverage or Eagle acceptance.

It never mutates XML. Retained elements are the original object references in
original order; the caller must clone them for a NEW disabled local Master, clear
new algorithms/bindings and disclose every omitted window as unfinished work.
Original teaching and its unsupported relationships must remain untouched.
"""
from collections import defaultdict, deque
import re

from .qualification_candidate import _fail


PROFILE = 'native-window-closed-subset-1'
MAX_WINDOWS = 256
_ID = re.compile(r'(?:[1-9][0-9]{0,8}|[A-Za-z][A-Za-z0-9]{0,127})\Z')
_GROUP = re.compile(r'(?:0|[1-9][0-9]{0,8})\Z')
_REMAINING = ['native-window-subset-incomplete', 'omitted-window-creation-and-teaching-required']


def _scalar(node, field, *, empty=False):
    found = node.findall(field)
    if len(found) != 1 or found[0].attrib or len(found[0]):
        _fail('PREPARATION_WINDOW_LINK', 'Window relationships require unique plain scalar fields.')
    value = found[0].text or ''
    if not isinstance(value, str) or len(value) > 2048 or not empty and not value:
        _fail('PREPARATION_WINDOW_LINK', 'Window relationships contain an unsupported scalar.')
    return value


def closed_window_subset(windows):
    """Return retained Elements and exact omissions, or refuse an empty subset.

    A missing external parent/alignment target removes its referring window.
    Every parent cycle is removed. Removal cascades through parent/alignment
    dependents and through every member of the affected nonzero group. Group
    zero remains an ungrouped literal and does not combine unrelated windows.
    Thus an accepted subset never copies a known dangling link or half a group.
    These mechanical checks do not promote partial preparation to teaching.
    """
    if not isinstance(windows, (list, tuple)) or not 1 <= len(windows) <= MAX_WINDOWS:
        _fail('PREPARATION_WINDOW_LINK', 'A bounded nonempty validated local window set is required.')
    records, groups = {}, defaultdict(list)
    for ordinal, window in enumerate(windows, 1):
        wid, group = _scalar(window, 'ID'), _scalar(window, 'GroupID')
        if not _ID.fullmatch(wid) or not _GROUP.fullmatch(group) or wid in records:
            _fail('PREPARATION_WINDOW_LINK', 'Window and group identities must be canonical and local window IDs unique.')
        records[wid] = {'element': window, 'ordinal': ordinal, 'group': group,
                        'parent': _scalar(window, 'ParentWndId'),
                        'align': _scalar(window, 'AlignWndID', empty=True)}
        if group != '0':
            groups[group].append(wid)

    omitted, queue = {}, deque()

    def remove(wid, reason, related):
        if wid not in omitted:
            omitted[wid] = {'reasons': [], 'related': []}
            queue.append(wid)
        note = omitted[wid]
        if reason not in note['reasons']:
            note['reasons'].append(reason)
        if related and related not in note['related']:
            note['related'].append(related)

    dependents = defaultdict(list)
    for wid, record in records.items():
        for field, neutral, reason in (('parent', '0', 'external-parent-window'),
                                       ('align', '', 'external-alignment-window')):
            target = record[field]
            if target == neutral:
                continue
            if target not in records:
                remove(wid, reason, target)
            else:
                dependents[target].append((wid, field))

    # A parent is a single known relationship, so every chain can be visited
    # once. Record each cycle member without duplicating whole cycle payloads.
    visited = set()
    for start in records:
        path, positions, at = [], {}, start
        while at in records and at not in visited and at not in positions:
            positions[at] = len(path)
            path.append(at)
            at = records[at]['parent']
        if at in positions:
            for wid in path[positions[at]:]:
                remove(wid, 'parent-window-cycle', records[wid]['parent'])
        visited.update(path)

    removed_groups = set()
    while queue:
        removed = queue.popleft()
        for dependent, field in dependents.get(removed, ()):
            remove(dependent, 'omitted-' + field + '-window', removed)
        group = records[removed]['group']
        if group != '0' and group not in removed_groups:
            removed_groups.add(group)
            for member in groups[group]:
                if member not in omitted:
                    remove(member, 'affected-nonzero-window-group', removed)

    retained = [record['element'] for wid, record in records.items() if wid not in omitted]
    if not retained:
        _fail('PREPARATION_WINDOW_LINK', 'No nonempty closed rectangular window subset remains; local window creation is still required.')
    details = [{'windowId': wid, 'groupId': record['group'], 'templateWindowOrdinal': record['ordinal'],
                'reasons': sorted(omitted[wid]['reasons']), 'relatedWindowIds': sorted(omitted[wid]['related'])}
               for wid, record in records.items() if wid in omitted]
    return {'profile': PROFILE, 'retained': retained, 'omitted': details,
            'complete': not details, 'remaining': list(_REMAINING) if details else []}
