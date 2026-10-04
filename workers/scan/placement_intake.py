"""Bounded read-only placement intake. No alignment, inferred geometry or native export."""
from __future__ import annotations

import csv
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
from hashlib import sha256
import io
import json
import re
import zipfile

from defusedxml import ElementTree as SafeXML
import openpyxl
from openpyxl.utils.cell import range_boundaries

MAX_BYTES = 8_000_000
MAX_ROWS = 10_000
MAX_COLUMNS = 64
MAX_CELL = 2048
MAX_XML = 32_000_000


class IntakeError(Exception):
    pass


@dataclass
class Table:
    rows: list[list]
    sheets: list[dict]
    merged: list[tuple[int, int, int, int]]
    sheet_index: int


def _zip_guard(data: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) > 2000 or sum(i.file_size for i in infos) > MAX_XML:
            raise IntakeError("Workbook exceeds ZIP entry or decompression limits.")
        names = set()
        total = 0
        for info in infos:
            name = info.filename.replace('\\', '/')
            if name.casefold() in names or '..' in name.split('/') or name.startswith('/') or ':' in name:
                raise IntakeError("Workbook has ambiguous or unsafe ZIP members.")
            names.add(name.casefold())
            if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise IntakeError("Encrypted or unsupported workbook compression.")
            if info.file_size > 16_000_000 or info.file_size > max(info.compress_size, 1) * 250:
                raise IntakeError("Workbook member exceeds its decompression limit.")
            if 'vbaproject' in name.lower() or '/embeddings/' in name.lower() or '/externallinks/' in name.lower():
                raise IntakeError("Macros, embedded objects and external workbook links are unsupported.")
            with archive.open(info) as member:
                raw = member.read(min(info.file_size, 16_000_000) + 1)
            total += len(raw)
            if len(raw) != info.file_size or total > MAX_XML:
                raise IntakeError("Workbook payload exceeds its declared size.")
            if name.lower().endswith(('.xml', '.rels')):
                # Parse with DTDs/entities/external references forbidden before openpyxl.
                root = SafeXML.fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
                if name.lower().endswith('.rels') and any(e.get('TargetMode') == 'External' for e in root.iter()):
                    raise IntakeError("External workbook relationships are unsupported.")
                if '/worksheets/' in name.lower() and name.lower().endswith('.xml'):
                    for e in root.iter():
                        tag = e.tag.rsplit('}', 1)[-1]
                        if tag == 'row' and int(e.get('r', '0')) > MAX_ROWS:
                            raise IntakeError("Worksheet exceeds the 10,000-row limit.")
                        if tag == 'c':
                            col, row, _, _ = range_boundaries(e.get('r', 'A1'))
                            if col > MAX_COLUMNS or row > MAX_ROWS:
                                raise IntakeError("Worksheet exceeds row or column limits.")


def read_table(data: bytes, kind: str, sheet_index: int = 0, delimiter: str = ',') -> Table:
    if not data or len(data) > MAX_BYTES:
        raise IntakeError("Select a nonempty file no larger than 8 MB.")
    if type(sheet_index) is not int or not 0 <= sheet_index < 20:
        raise IntakeError("Select a valid worksheet index.")
    if delimiter not in (',', ';', '\t'):
        raise IntakeError("CSV delimiter must be comma, semicolon or tab.")
    merged = []
    if kind == 'csv':
        if sheet_index != 0:
            raise IntakeError("CSV has only one sheet.")
        try:
            text = data.decode('utf-8-sig')
        except UnicodeError:
            raise IntakeError("CSV must be UTF-8. Save legacy encodings as UTF-8 first.") from None
        reader = csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, strict=True)
        rows = []
        for row in reader:
            if len(rows) >= MAX_ROWS or len(row) > MAX_COLUMNS:
                raise IntakeError("CSV exceeds 10,000 rows or 64 columns.")
            rows.append(row)
        sheets = [{'index': 0, 'name': 'CSV'}]
    elif kind == 'xlsx':
        if not openpyxl.DEFUSEDXML:
            raise IntakeError("The required protected XML reader is unavailable.")
        _zip_guard(data)
        workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=False, keep_links=False)
        try:
            if len(workbook.worksheets) > 20 or sheet_index >= len(workbook.worksheets):
                raise IntakeError("Select one of the supported worksheets (maximum 20).")
            sheets = [{'index': i, 'name': s.title} for i, s in enumerate(workbook)]
            sheet = workbook.worksheets[sheet_index]
            # Do not trust omitted or incorrect producer dimension metadata.
            sheet.reset_dimensions()
            rows = []
            for row in sheet.iter_rows():
                if len(rows) >= MAX_ROWS or len(row) > MAX_COLUMNS:
                    raise IntakeError("Worksheet exceeds 10,000 rows or 64 columns.")
                rows.append([{'special': c.data_type} if c.data_type in ('f', 'e') else c.value for c in row])
            # The reader exposes the selected worksheet's package path internally;
            # use its resolved relationship, never assume sheet index == sheetN.xml.
            with workbook._archive.open(sheet._worksheet_path) as stream:
                root = SafeXML.parse(stream, forbid_dtd=True).getroot()
            merged = [range_boundaries(e.attrib['ref']) for e in root.iter() if e.tag.rsplit('}', 1)[-1] == 'mergeCell']
        finally:
            workbook.close()
    else:
        raise IntakeError("Only .xlsx and UTF-8 .csv placement files are supported.")
    width = max((len(row) for row in rows), default=0)
    for row in rows:
        row.extend([None] * (width - len(row)))
        if any(isinstance(v, str) and (len(v) > MAX_CELL or '\0' in v) for v in row):
            raise IntakeError("A cell exceeds the text limit or contains a NUL character.")
    if not rows or not width:
        raise IntakeError("The selected sheet is empty.")
    return Table(rows, sheets, merged, sheet_index)


def inspect_table(table: Table, data: bytes) -> dict:
    def preview(v):
        if isinstance(v, dict): return '[Formula]' if v.get('special') == 'f' else '[Excel error]'
        if v is None or isinstance(v, (str, int, float, bool)): return v
        return '[Unsupported cell type]'
    return {'status': 'success', 'artifactType': 'scan.placement-preview', 'sourceSha256': sha256(data).hexdigest(),
            'sheets': table.sheets, 'sheetIndex': table.sheet_index, 'rowCount': len(table.rows),
            'columnCount': len(table.rows[0]), 'preview': [[preview(v) for v in row] for row in table.rows[:6]],
            'machineExportAllowed': False}


def _identifier(value, required=True) -> str | None:
    if value is None or value == '':
        if required: raise IntakeError("Required identity is blank.")
        return None
    if not isinstance(value, str) or value.startswith(('=', '+', '@')):
        raise IntakeError("Identity must be literal text; numeric identifiers require a text-formatted source.")
    value = value.strip()
    if not value or len(value) > 256 or any(ord(c) < 32 for c in value):
        raise IntakeError("Identity is blank, too long or contains control characters.")
    return value


def _number(value, decimal_separator) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, float, int)):
        raise IntakeError("Required number is missing, a formula, an error or an unsupported cell type.")
    text = str(value).strip()
    # Numeric spreadsheet cells are already numbers, independent of display locale.
    if isinstance(value, str) and decimal_separator == ',':
        if '.' in text: raise IntakeError("Number conflicts with the selected decimal separator.")
        text = text.replace(',', '.')
    if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?', text):
        raise IntakeError("Expected one number without units or thousands separators.")
    try:
        number = Decimal(text)
        if not number.is_finite() or abs(number) > Decimal('1000000000'):
            raise IntakeError("Number is nonfinite or exceeds the supported range.")
        return number
    except InvalidOperation:
        raise IntakeError("Invalid number.") from None


def normalize(table: Table, data: bytes, config: dict) -> dict:
    required = {'startRow', 'columns', 'module', 'side', 'units', 'rotationDirection', 'decimalSeparator', 'pairSeparator'}
    if not isinstance(config, dict) or set(config) != required:
        raise IntakeError("Placement mapping fields are missing or unrecognized.")
    columns = config['columns']
    allowed = {'refdes', 'mpn', 'x', 'y', 'xy', 'rotation', 'side', 'module', 'footprint'}
    if not isinstance(columns, dict) or not set(columns) <= allowed or not {'refdes', 'rotation'} <= set(columns):
        raise IntakeError("Map reference designator, rotation, and either X/Y or combined XY columns.")
    if ('xy' in columns) == ('x' in columns or 'y' in columns) or ('xy' not in columns and not {'x', 'y'} <= set(columns)):
        raise IntakeError("Choose separate X and Y columns or one combined XY column.")
    if any(type(c) is not int or not 1 <= c <= len(table.rows[0]) for c in columns.values()) or len(set(columns.values())) != len(columns):
        raise IntakeError("Each mapped field needs its own valid column number.")
    start = config['startRow']
    if type(start) is not int or not 1 <= start <= len(table.rows):
        raise IntakeError("First data row is outside this sheet.")
    if config['units'] not in ('unknown', 'mm', 'inch', 'mil') or config['rotationDirection'] not in ('unknown', 'cw', 'ccw'):
        raise IntakeError("Select supported units and rotation direction, or unknown.")
    if config['decimalSeparator'] not in ('.', ',') or config['pairSeparator'] not in (',', ';', 'space'):
        raise IntakeError("Select explicit decimal and XY separators.")
    if 'xy' in columns and config['decimalSeparator'] == config['pairSeparator']:
        raise IntakeError("Decimal and XY separators must differ.")
    if not isinstance(config['module'], str) or not isinstance(config['side'], str):
        raise IntakeError("Module and side controls must be text.")
    holds = []
    if config['units'] == 'unknown': holds.append('Confirm placement units before coordinate conversion.')
    if config['rotationDirection'] == 'unknown': holds.append('Confirm the source rotation direction before angle conversion.')
    issues = []
    records = []
    seen = {}
    skipped = 0
    scale = {'mm': Decimal(1), 'inch': Decimal('25.4'), 'mil': Decimal('0.0254')}.get(config['units'])
    for row_number, row in enumerate(table.rows[start - 1:], start):
        if all(v is None or v == '' for v in row):
            skipped += 1
            continue
        def cell(field, default=None):
            return row[columns[field] - 1] if field in columns else default
        try:
            if any(y1 <= row_number <= y2 and any(x1 <= c <= x2 for c in columns.values()) for x1, y1, x2, y2 in table.merged):
                raise IntakeError("A mapped cell is merged. Unmerge it in a separate source copy before import.")
            refdes = _identifier(cell('refdes'))
            module = _identifier(cell('module', config['module']))
            side_raw = _identifier(cell('side', config['side']))
            side = {'top': 'Top', 'top layer': 'Top', 'toplayer': 'Top', 'bottom': 'Bottom', 'bottom layer': 'Bottom', 'bottomlayer': 'Bottom'}.get(side_raw.casefold())
            if side is None: raise IntakeError("Board side must explicitly be Top or Bottom.")
            if 'xy' in columns:
                pair = cell('xy')
                if not isinstance(pair, str): raise IntakeError("Combined XY must contain two text numbers.")
                parts = pair.split() if config['pairSeparator'] == 'space' else pair.split(config['pairSeparator'])
                if len(parts) != 2: raise IntakeError("Combined XY does not contain exactly two numbers with the selected separator.")
                raw_x, raw_y = parts
            else:
                raw_x, raw_y = cell('x'), cell('y')
            x, y, angle = (_number(v, config['decimalSeparator']) for v in (raw_x, raw_y, cell('rotation')))
            mpn = _identifier(cell('mpn'), required=False)
            footprint = _identifier(cell('footprint'), required=False)
            identity = (module.casefold(), side, refdes.casefold())
            if identity in seen:
                issues.append({'row': row_number, 'severity': 'error', 'message': f'Duplicate module/side/reference identity; also present at row {seen[identity]}.'})
            else: seen[identity] = row_number
            if mpn is None:
                issues.append({'row': row_number, 'severity': 'warning', 'message': 'MPN is missing; component identity is unresolved.'})
            converted_angle = None
            # Source cells are capped at 2,048 chars and exponents at three digits.
            # A larger bounded context preserves all allowed decimal digits.
            with localcontext() as context:
                context.prec = 4096
                x_mm = str(x * scale) if scale is not None else None
                y_mm = str(y * scale) if scale is not None else None
                if config['rotationDirection'] != 'unknown':
                    signed = angle if config['rotationDirection'] == 'ccw' else -angle
                    converted = signed % 360
                    if converted < 0: converted += 360
                    converted_angle = str(converted)
            records.append({'placementId': sha256(json.dumps([module, side, refdes], ensure_ascii=True).encode()).hexdigest(),
                            'module': module, 'side': side, 'refdes': refdes, 'mpn': mpn, 'footprint': footprint,
                            'sourceRow': row_number, 'sourceCoordinates': {'x': str(x), 'y': str(y), 'rotation': str(angle)},
                            'xMm': x_mm, 'yMm': y_mm, 'rotationCcwDegrees': converted_angle})
        except IntakeError as error:
            issues.append({'row': row_number, 'severity': 'error', 'message': str(error)})
    errors = sum(i['severity'] == 'error' for i in issues)
    warnings = len(issues) - errors
    if errors: holds.append('Resolve all row errors; partial results are not a complete placement set.')
    if not records: holds.append('No valid placement rows were found.')
    return {'status': 'blocked' if holds else 'success', 'artifactType': 'scan.normalized-placements', 'schemaVersion': '1',
            'sourceSha256': sha256(data).hexdigest(), 'sheetIndex': table.sheet_index, 'mapping': config,
            'coordinateFrame': 'source CAD frame; no alignment, origin shift or bottom-side mirror applied',
            'counts': {'sourceRows': len(table.rows) - start + 1, 'parsed': len(records), 'skippedBlank': skipped, 'errors': errors, 'warnings': warnings},
            'placements': records, 'issues': issues, 'holds': holds, 'machineExportAllowed': False,
            'coverage': {'represented': None, 'enabled': None, 'taught': None, 'verified': None, 'released': None}}
