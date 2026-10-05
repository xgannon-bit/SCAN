"""Engineering BOM evidence with bounded grouped-reference expansion.

No population approval, substitution approval, coordinates or native edits are
derived here. Original cells and row/worksheet provenance stay attached.
"""
from collections import defaultdict
from hashlib import sha256
import json
import re

from .placement_intake import IntakeError, inspect_table

FIELDS = ('quantity', 'refdes', 'value', 'description', 'manufacturer', 'mpn', 'footprint')
REFERENCE = re.compile(r'([A-Za-z][A-Za-z0-9_]*?)([0-9]+)\Z')
RANGE = re.compile(r'([A-Za-z][A-Za-z0-9_]*?)([0-9]+)-([A-Za-z][A-Za-z0-9_]*?)?([0-9]+)\Z')


def expand_references(raw):
    if not isinstance(raw, str) or len(raw) > 2048 or not raw.strip():
        raise IntakeError('A bounded literal reference list is required.')
    output = []
    for token in re.split(r'[,;\s]+', raw.strip()):
        if not token:
            continue
        if REFERENCE.fullmatch(token):
            output.append(token)
        else:
            match = RANGE.fullmatch(token)
            if not match or (match[3] and match[1].upper() != match[3].upper()):
                raise IntakeError('Ambiguous reference or range; use explicit references or a same-prefix ascending range.')
            first, last = int(match[2]), int(match[4])
            if first > last or last - first > 999 or (match[2].startswith('0') and len(match[2]) > 1) or (match[4].startswith('0') and len(match[4]) > 1):
                raise IntakeError('Descending, padded or excessive ranges need explicit reference lists.')
            output.extend(f'{match[1]}{number}' for number in range(first, last + 1))
        if len(output) > 1000:
            raise IntakeError('One BOM group exceeds 1,000 references.')
    if len(set(ref.upper() for ref in output)) != len(output):
        raise IntakeError('Duplicate references or normalization collision within this group.')
    return output


def normalize_bom(table, data, config):
    if not isinstance(config, dict) or set(config) != {'headerRow', 'columns', 'scope', 'revision', 'variant'}:
        raise IntakeError('BOM requires explicit header row, seven column mappings, scope and revision/variant fields.')
    header = config['headerRow']; columns = config['columns']; scope = config['scope']
    if type(header) is not int or not 1 <= header <= len(table.rows):
        raise IntakeError('Select an existing BOM header row.')
    if not isinstance(columns, dict) or set(columns) != set(FIELDS) or any(type(v) is not int or not 1 <= v <= len(table.rows[0]) for v in columns.values()) or len(set(columns.values())) != len(FIELDS):
        raise IntakeError('Map each BOM field to a distinct existing column.')
    if not isinstance(scope, dict) or set(scope) != {'module', 'side', 'boardInstance'} or any(not isinstance(v, str) or len(v) > 256 or '\0' in v for v in [*scope.values(), config['revision'], config['variant']]):
        raise IntakeError('Invalid bounded BOM scope or revision context.')
    if any(bottom >= header and any(left <= col <= right for col in columns.values()) for left, top, right, bottom in table.merged):
        raise IntakeError('Merged cells overlap mapped BOM evidence; provide explicit values for each group.')
    groups, references, issues = [], [], []
    index = defaultdict(list)
    quantity_total = 0
    def issue(row, code, message):
        issues.append({'row': row, 'severity': 'error', 'code': code, 'message': message})
    for row_number, row in enumerate(table.rows[header:], header + 1):
        if all(v is None or v == '' for v in row):
            continue
        raw = {key: row[column - 1] for key, column in columns.items()}
        group = {'sourceRow': row_number, 'raw': raw, 'references': [], 'quantity': None, 'quantityMatches': False,
                 'populationEvidence': 'unknown', 'mpnInterpretation': 'unavailable', 'interpretedMpn': None}
        groups.append(group)
        if any(isinstance(v, (dict, bool)) or isinstance(v, str) and v.lstrip().startswith(('=', '@')) for v in row):
            issue(row_number, 'UNSAFE_CELL', 'Formula/error or unsafe cell values are not evaluated. Correct the source before interpreting this group.')
            continue
        try:
            expanded = expand_references(raw['refdes'])
        except IntakeError as error:
            issue(row_number, 'REFERENCE_LIST', str(error)); continue
        group['references'] = expanded
        quantity_text = str(raw['quantity']).strip()
        if not re.fullmatch(r'[0-9]+(?:\.0+)?', quantity_text) or float(quantity_text) > 10000:
            issue(row_number, 'QUANTITY_INVALID', 'Quantity is blank or is not a bounded nonnegative integer.')
        else:
            group['quantity'] = int(float(quantity_text)); quantity_total += group['quantity']
            group['quantityMatches'] = group['quantity'] == len(expanded)
            if not group['quantityMatches']:
                issue(row_number, 'QUANTITY_MISMATCH', 'Declared quantity differs from the expanded reference count.')
        value = str(raw['value'] or '').strip()
        mpn = str(raw['mpn'] or '').strip()
        dnp = value.upper() in ('DNP', 'DNI', 'DO NOT POPULATE', 'NOT FITTED')
        group['populationEvidence'] = 'engineering-dnp' if dnp else 'engineering-listed'
        if dnp:
            group['mpnInterpretation'] = 'dnp-group-raw-only'
        elif not mpn or mpn.upper() in ('DNP', 'DNI', '[NOVALUE]', 'NOVALUE', 'N/A'):
            group['mpnInterpretation'] = 'missing-or-placeholder'
        else:
            group['mpnInterpretation'] = 'literal-group-mpn'; group['interpretedMpn'] = mpn
        for ref in expanded:
            normalized = ref.upper()
            item = {'sourceRow': row_number, 'rawRefdes': ref, 'normalizedRefdes': normalized,
                    'rawGroupRefdes': raw['refdes'], 'rawMpn': raw['mpn'], 'rawValue': raw['value'],
                    'mpn': group['interpretedMpn'], 'populationEvidence': group['populationEvidence'],
                    'scope': scope, 'workOrderPopulation': 'unapproved', 'quantityMatches': group['quantityMatches']}
            references.append(item); index[normalized].append(item)
        if len(references) > 10000:
            raise IntakeError('Expanded BOM exceeds 10,000 references.')
    for ref, records in index.items():
        if len(records) > 1:
            code = 'NORMALIZATION_COLLISION' if len({item['rawRefdes'] for item in records}) > 1 else 'DUPLICATE_REFERENCE'
            for item in records:
                issue(item['sourceRow'], code, 'This matching key occurs in multiple BOM groups; no row is silently selected.')
    result = {'artifactType': 'scan.engineering-bom', 'schemaVersion': '1', 'parserVersion': 'bom-1',
              'status': 'blocked' if issues else 'success', 'sourceSha256': sha256(data).hexdigest(),
              'sheetIndex': table.sheet_index, 'worksheet': table.sheets[table.sheet_index]['name'],
              'config': config, 'headers': table.rows[header - 1], 'preview': inspect_table(table, data)['preview'],
              'groups': groups, 'references': references, 'issues': issues,
              'counts': {'groups': len(groups), 'expandedReferences': len(references), 'uniqueReferences': len(index),
                         'quantityTotal': quantity_total, 'engineeringDnpReferences': sum(item['populationEvidence'] == 'engineering-dnp' for item in references)},
              'workOrderPopulation': 'unapproved', 'machineExportAllowed': False}
    if len(json.dumps(result)) > 20_000_000:
        raise IntakeError('BOM evidence exceeds its result limit.')
    return result
