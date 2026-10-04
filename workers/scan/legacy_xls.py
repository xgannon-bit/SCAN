"""Conservative literal-cell BIFF8 profile; cached formulas are never placements."""
import io
import struct
import xlrd
from xlrd.compdoc import CompDoc


def read_legacy(data, sheet_index, error):
    if not data.startswith(bytes.fromhex('D0CF11E0A1B11AE1')):
        raise error('Legacy XLS must be an OLE BIFF8 workbook, not renamed text.')
    container = CompDoc(data, logfile=io.StringIO(), ignore_workbook_corruption=False)
    if any('vba' in entry.name.lower() or entry.name.lower() == 'macros' for entry in container.dirlist):
        raise error('XLS macro streams are unsupported.')
    memory, base, length = container.locate_named_stream('Workbook')
    if memory is None or length > 8_000_000 or length < 8:
        raise error('A bounded BIFF8 Workbook stream is required.')
    source = memoryview(memory)[base:base + length]
    first_code, first_size = struct.unpack_from('<HH', source)
    if first_code != 0x0809 or first_size < 4 or struct.unpack_from('<H', source, 4)[0] != 0x0600:
        raise error('Only BIFF8 legacy XLS is supported.')
    forbidden = {0x0006, 0x0206, 0x0406, 0x0221, 0x0021, 0x04bc, 0x0236, 0x0037, 0x0036,
                 0x002f, 0x0018, 0x0023, 0x0223, 0x0017, 0x01ae, 0x01b8, 0x005d}
    cells = {0x0203, 0x00fd, 0x0204, 0x00d6, 0x027e, 0x0205, 0x0201}
    cursor = records = sheets = 0
    active = None; global_seen = False; sheet_offsets = []; sheet_boundaries = set()
    while cursor < length:
        record_offset = cursor
        if length - cursor < 4:
            if any(source[cursor:]): raise error('Truncated XLS record.')
            break
        code, size = struct.unpack_from('<HH', source, cursor)
        cursor += 4; records += 1
        if records > 200_000 or cursor + size > length or size > 8224:
            raise error('XLS records exceed supported limits or are truncated.')
        record = source[cursor:cursor + size]; cursor += size
        if code == 0 and size == 0 and active is None and not any(source[record_offset:]): break
        if code == 0x0809:
            if active is not None or size < 4 or struct.unpack_from('<H', record)[0] != 0x0600:
                raise error('Invalid BIFF8 substream framing.')
            active = struct.unpack_from('<H', record, 2)[0]
            if not global_seen:
                if record_offset != 0 or active != 5: raise error('Workbook globals must be first.')
                global_seen = True
            elif active == 0x10:
                sheet_boundaries.add(record_offset)
            else: raise error('Only ordinary BIFF8 worksheet substreams are supported.')
        elif code == 0x000a:
            if active is None or size: raise error('Invalid XLS end of substream.')
            active = None
        elif active is None:
            raise error('XLS record occurs outside a declared substream.')
        if code in forbidden:
            raise error('XLS formulas, external references, names, encryption and embedded objects are unsupported. Export a reviewed literal-cell copy.')
        if code == 0x0085:
            sheets += 1
            if active != 5 or size < 8 or record[5] != 0 or sheets > 20:
                raise error('Only up to 20 ordinary XLS worksheets are supported.')
            sheet_offsets.append(struct.unpack_from('<I', record)[0])
        if code in cells | {0x00bd, 0x00be, 0x0208}:
            if size < 4: raise error('Malformed XLS cell record.')
            row, col = struct.unpack_from('<HH', record)
            if row >= 10_000 or col >= 64: raise error('XLS exceeds 10,000 rows or 64 columns.')
            if code in {0x00bd, 0x00be} and (size < 6 or struct.unpack_from('<H', record, size - 2)[0] >= 64):
                raise error('XLS cell range exceeds column limits.')
            if code == 0x0208 and (size < 6 or struct.unpack_from('<H', record, 4)[0] > 64):
                raise error('XLS row range exceeds column limits.')
        if code == 0x0200:
            if size < 12 or struct.unpack_from('<I', record, 4)[0] > 10_000 or struct.unpack_from('<H', record, 10)[0] > 64:
                raise error('XLS worksheet dimensions exceed supported limits.')
        if code == 0x00fc and (size < 8 or struct.unpack_from('<I', record, 4)[0] > 640_000):
            raise error('XLS shared strings exceed supported limits.')
        if code == 0x00e5:
            if size < 2 or size != 2 + 8 * struct.unpack_from('<H', record)[0]: raise error('Malformed XLS merged ranges.')
            for offset in range(2, size, 8):
                r1, r2, c1, c2 = struct.unpack_from('<HHHH', record, offset)
                if r2 >= 10_000 or c2 >= 64 or r1 > r2 or c1 > c2: raise error('XLS merged range exceeds supported limits.')
    if active is not None or not sheets or len(set(sheet_offsets)) != sheets or set(sheet_offsets) != sheet_boundaries:
        raise error('XLS worksheet offsets do not match complete BIFF8 substreams.')
    workbook = xlrd.open_workbook(file_contents=data, formatting_info=True, on_demand=True, ragged_rows=True, logfile=io.StringIO())
    try:
        if workbook.biff_version != 80 or not 0 <= sheet_index < workbook.nsheets <= 20:
            raise error('Select a supported BIFF8 worksheet index.')
        sheet = workbook.sheet_by_index(sheet_index)
        if sheet.nrows > 10_000 or sheet.ncols > 64: raise error('XLS exceeds row or column limits.')
        def value(cell):
            if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK): return None
            if cell.ctype in (xlrd.XL_CELL_TEXT, xlrd.XL_CELL_NUMBER): return cell.value
            return {'special': 'e' if cell.ctype == xlrd.XL_CELL_ERROR else 'unsupported'}
        rows = [[value(cell) for cell in sheet.row(index)] for index in range(sheet.nrows)]
        merged = [(c1 + 1, r1 + 1, c2, r2) for r1, r2, c1, c2 in sheet.merged_cells]
        return rows, [{'index': i, 'name': name} for i, name in enumerate(workbook.sheet_names())], merged
    finally:
        workbook.release_resources()
