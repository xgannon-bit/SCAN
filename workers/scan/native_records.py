"""Read observed JobContainer records without assigning unqualified semantics.

This profile recognizes field paths, not vendor compatibility. Source values stay
literal, coordinate units/frames and reference relationships stay unverified.
Nothing is serialized back to native XML.
"""
import json
from defusedxml.ElementTree import DefusedXMLParser

_COLLECTIONS = {
    'JobContainer/ModuleDataList/ModuleData': ('module-record', {'ID', 'ArrayNo', 'ModelNo', 'TB', 'ENABLE', 'Angle', 'Shift/X', 'Shift/Y', 'RotCenter/X', 'RotCenter/Y'}),
    'JobContainer/PartDataList/PartData': ('part-record', {'ID', 'No', 'Name', 'RefID', 'ModelNo', 'MasterKey', 'ParentId', 'ENABLE', 'CenterPosX', 'CenterPosY', 'CadOffset/X', 'CadOffset/Y', 'Roi/cx', 'Roi/cy', 'Roi/w', 'Roi/h', 'Roi/a'}),
    'JobContainer/WindowDataList/WindowData': ('window-record', {'ID', 'Name', 'ParentId', 'ParentWndId', 'GroupID', 'ENABLE', 'RelRoi/cx', 'RelRoi/cy', 'RelRoi/w', 'RelRoi/h', 'RelRoi/a'}),
    'JobContainer/CadData/CpList/Cp': ('cad-record', {'ID', 'ModuleID', 'RefID', 'MountNo', 'PrntPartName', 'PrntSetName', 'X', 'Y', 'Ang'}),
}


class _Records:
    def __init__(self):
        self.stack = []
        self.nodes = 0
        self.root = None
        self.version = None
        self.version_count = 0
        self.version_nested = False
        self.records = []
        self.current = None
        self.collection = None
        self.ordinals = {}
        self.text = None
        self.field = None
        self.total_text = 0
        self.duplicates = []
        self.containers = set()

    def start(self, tag, attributes):
        self.nodes += 1
        self.stack.append(tag)
        if self.nodes > 250_000 or len(self.stack) > 128 or len(tag) > 512 or len(attributes) > 64:
            raise ValueError('limit')
        if len(self.stack) == 1:
            self.root = tag
        path = '/'.join(self.stack)
        if path in {collection.rsplit('/', 1)[0] for collection in _COLLECTIONS}:
            if path in self.containers:
                raise ValueError('repeated collection container')
            self.containers.add(path)
        if path == 'JobContainer/JobXmlVersion':
            self.version_count += 1
            self.version = ''
        elif path.startswith('JobContainer/JobXmlVersion/'):
            self.version_nested = True
        if path in _COLLECTIONS:
            if self.current is not None or len(self.records) >= 10_000:
                raise ValueError('record limit')
            self.collection = path
            self.ordinals[path] = self.ordinals.get(path, 0) + 1
            self.current = {'kind': _COLLECTIONS[path][0], 'sourcePath': f'{path}[{self.ordinals[path]}]', 'rawFields': {}}
        if self.current:
            relative = path[len(self.collection) + 1:]
            if relative in _COLLECTIONS[self.collection][1]:
                self.field = relative
                self.text = ''
            elif self.field is not None:
                # A promised scalar must not silently flatten nested content.
                raise ValueError('nested scalar')

    def data(self, value):
        if '/'.join(self.stack) == 'JobContainer/JobXmlVersion':
            self.version += value
            if len(self.version) > 64:
                raise ValueError('version limit')
        if self.text is not None:
            self.total_text += len(value)
            self.text += value
            if len(self.text) > 2048 or self.total_text > 2_000_000:
                raise ValueError('text limit')

    def end(self, tag):
        path = '/'.join(self.stack)
        if self.current and self.field and path == self.collection + '/' + self.field:
            fields = self.current['rawFields']
            if self.field in fields:
                self.duplicates.append({'sourcePath': self.current['sourcePath'], 'field': self.field})
            fields.setdefault(self.field, []).append(self.text)
            self.field = self.text = None
        if self.current and path == self.collection:
            self.records.append(self.current)
            self.current = self.collection = None
        self.stack.pop()

    def close(self):
        if self.root != 'JobContainer':
            return {'status': 'unsupported', 'reason': 'No record profile for this XML root.', 'records': [], 'machineExportAllowed': False}
        version = self.version.strip() if self.version is not None else None
        if version != '10.2' or self.version_count != 1 or self.version_nested:
            return {'status': 'unsupported', 'reason': 'Record profile requires one literal JobXmlVersion 10.2 claim; this is not an Eagle application version.', 'records': [], 'machineExportAllowed': False}
        return {
            'status': 'recorded', 'readerProfile': 'jobcontainer-10.2-observed-readonly-1', 'schemaVersionClaim': version,
            'profileQualification': 'observed-field-paths-only', 'records': self.records,
            'countsByRecordKind': {kind: sum(record['kind'] == kind for record in self.records) for kind, _ in _COLLECTIONS.values()},
            'duplicateScalarFields': self.duplicates,
            'coordinateInterpretation': 'unverified; source strings only; no units, transforms or common frame assigned',
            'relationshipInterpretation': 'unverified; IDs and parent/master fields are source claims, not resolved dependencies',
            'coverageInterpretation': 'Record counts are not programmed, enabled, taught, verified or released component counts.',
            'unknownFields': 'Preserved in the verified snapshot; not interpreted or rewritten.',
            'nativeSchemaQualified': False, 'machineExportAllowed': False,
        }


def read_native_records(stream, size):
    if size > 16_000_000:
        return {'status': 'blocked', 'reason': 'Native record byte limit exceeded.', 'records': [], 'machineExportAllowed': False}
    try:
        parser = DefusedXMLParser(target=_Records(), forbid_dtd=True, forbid_entities=True, forbid_external=True)
        remaining = 16_000_000
        while chunk := stream.read(min(65536, remaining + 1)):
            remaining -= len(chunk)
            if remaining < 0:
                raise ValueError('byte limit')
            parser.feed(chunk)
        result = parser.close()
        # Escaping non-ASCII source strings can multiply worker JSON output.
        # Keep each selected document's record report below 2 MB, leaving the
        # verified file inventory/envelope available when records exceed it.
        if len(json.dumps(result, ensure_ascii=True).encode('ascii')) > 2_000_000:
            raise ValueError('record output limit')
        return result
    except Exception:
        return {'status': 'blocked', 'reason': 'Native records contain unsupported structure, forbidden XML or exceed bounded reader limits. No contents were logged.', 'records': [], 'machineExportAllowed': False}
