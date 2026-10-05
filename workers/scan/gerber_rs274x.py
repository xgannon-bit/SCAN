from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
import os
import re
import json
from typing import Callable, Literal

Status = Literal["success", "blocked", "unsupported"]
Units = Literal["mm", "in", "unknown"]


@dataclass(frozen=True)
class GerberLimits:
    max_source_bytes: int = 20_000_000
    max_commands: int = 500_000
    max_apertures: int = 10_000
    max_objects: int = 30_000
    max_sr_expansion: int = 100_000
    max_numeric_token_length: int = 24
    max_attribute_length: int = 2_048
    max_comment_length: int = 4_096
    max_metadata_entries: int = 10_000

    def validate(self) -> None:
        if any(not isinstance(v, int) or v < 1 for v in asdict(self).values()):
            raise ValueError("Gerber limits must be positive integers")


@dataclass(frozen=True)
class CoordinateFormat:
    zero_omission: str
    notation: str
    x_integer: int
    x_decimal: int
    y_integer: int
    y_decimal: int


@dataclass(frozen=True)
class GerberAperture:
    d_code: int
    template: str
    parameters: tuple[str, ...]
    attributes: tuple[tuple[str, tuple[str, ...]], ...]


@dataclass(frozen=True)
class StepRepeat:
    x_count: int
    y_count: int
    i_step: str
    j_step: str


@dataclass(frozen=True)
class GerberObject:
    source_object_id: int
    instance_id: str
    operation: Literal["draw", "flash"]
    aperture_d_code: int
    polarity: Literal["dark", "clear"]
    start_x: str | None
    start_y: str | None
    end_x: str
    end_y: str
    sr_instance: tuple[int, int] | None


@dataclass(frozen=True)
class GerberResult:
    status: Status
    source_sha256: str
    source_size: int
    adapter_version: str
    units: Units
    coordinate_format: CoordinateFormat | None
    coordinate_frame: str
    file_attributes: tuple[tuple[str, tuple[str, ...]], ...]
    apertures: tuple[GerberAperture, ...]
    objects: tuple[GerberObject, ...]
    step_repeats: tuple[StepRepeat, ...]
    supported_features: tuple[str, ...]
    unsupported_features: tuple[str, ...]
    blocked_reasons: tuple[str, ...]
    declared_coordinate_format: CoordinateFormat | None = None
    interpretation_overrides: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    geometry_complete: bool = False
    diagnostics: tuple[dict, ...] = ()

    def to_dict(self) -> dict:
        return asdict(self)


class _Blocked(Exception):
    def __init__(self, message, **details):
        super().__init__(message)
        self.details = details


FS_RE = re.compile(r"^FS([LT])([AI])X([0-9])([0-9])Y([0-9])([0-9])$")
MO_RE = re.compile(r"^MO(MM|IN)$")
AD_RE = re.compile(r"^ADD(\d+)(C|R|O|P)(?:,(.+))?$")
SR_RE = re.compile(r"^SRX(\d+)Y(\d+)I([+-]?(?:\d+(?:\.\d*)?|\.\d+))J([+-]?(?:\d+(?:\.\d*)?|\.\d+))$")
FIELD_RE = re.compile(r"([XYIJD])([+-]?\d+)")
ATTR_RE = re.compile(r"^(TF|TA)\.([^,]+)(?:,(.*))?$")
D_RE = re.compile(r"^D(\d+)$")
UNSUPPORTED_EXT = {"AM": "APERTURE_MACRO", "AB": "APERTURE_BLOCK", "LM": "LOAD_MIRRORING", "LR": "LOAD_ROTATION", "LS": "LOAD_SCALING"}
UNSUPPORTED_NORMAL = (
    ("G36", "REGION_BEGIN"), ("G37", "REGION_END"),
    ("G02", "ARC_CLOCKWISE"), ("G03", "ARC_COUNTERCLOCKWISE"),
    ("G70", "DEPRECATED_UNIT_INCH"), ("G71", "DEPRECATED_UNIT_MM"),
    ("G74", "DEPRECATED_SINGLE_QUADRANT"), ("G75", "DEPRECATED_MULTI_QUADRANT"),
    ("G2", "ARC_CLOCKWISE"), ("G3", "ARC_COUNTERCLOCKWISE"),
)


def _hash(path: Path) -> str:
    h = sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _txt(value: Decimal) -> str:
    if value == 0:
        return "0"
    out = format(value, "f")
    return out.rstrip("0").rstrip(".") if "." in out else out


def _num(token: str, limits: GerberLimits) -> Decimal:
    if len(token) > limits.max_numeric_token_length:
        raise _Blocked("numeric token exceeds configured length limit")
    if not token.isascii() or not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)', token):
        raise _Blocked('numeric token must be a plain decimal without exponent notation')
    try:
        value = Decimal(token)
    except InvalidOperation as exc:
        raise _Blocked("invalid numeric token") from exc
    if not value.is_finite() or abs(value) > 1_000_000_000:
        raise _Blocked("non-finite numeric token is unsupported")
    return value


def _coord(token: str, integer: int, decimal: int, zero_mode: str, limits: GerberLimits) -> Decimal:
    if len(token) > limits.max_numeric_token_length:
        raise _Blocked("coordinate token exceeds configured length limit")
    sign = -1 if token.startswith("-") else 1
    digits = token[1:] if token[:1] in "+-" else token
    if "." in token or not digits.isdigit():
        raise _Blocked("coordinate token is malformed")
    width = integer + decimal
    if len(digits) > width:
        raise _Blocked("coordinate token exceeds declared FS width", token=token, expectedWidth=width, observedWidth=len(digits), decimalPlaces=decimal)
    if zero_mode == "L":
        digits = digits.rjust(width, "0")
    elif zero_mode == "T":
        digits = digits.ljust(width, "0")
    else:
        raise _Blocked("unsupported zero-omission mode")
    value = Decimal(int(digits)) / (Decimal(10) ** decimal)
    return value if sign > 0 else -value


def _commands(text: str, limits: GerberLimits) -> list[tuple[bool, str]]:
    out: list[tuple[bool, str]] = []
    buf: list[str] = []

    def add(block: str, extended: bool) -> None:
        if block.strip() and not block.rstrip().endswith('*'):
            raise _Blocked('command is missing its star terminator')
        chunks = [block.rstrip("*")] if extended and block.startswith("AM") else block.split("*")
        for raw in chunks:
            cmd = raw.strip()
            if cmd:
                out.append((extended, cmd))
                if len(out) > limits.max_commands:
                    raise _Blocked("command count exceeds configured limit")

    i = 0
    while i < len(text):
        if text[i] != "%":
            buf.append(text[i]); i += 1; continue
        if buf:
            add("".join(buf), False); buf.clear()
        j = text.find("%", i + 1)
        if j < 0:
            raise _Blocked("unterminated extended command block")
        add(text[i + 1:j].strip(), True); i = j + 1
    if buf:
        add("".join(buf), False)
    return out


def _attrs(values: dict[str, tuple[str, ...]]) -> tuple[tuple[str, tuple[str, ...]], ...]:
    return tuple(sorted(values.items()))


def _empty(status: Status, digest: str, size: int, reason: str = "", unsupported: str = "") -> GerberResult:
    return GerberResult(status, digest, size, "0.2", "unknown", None, "gerber-source-native", (), (), (), (), (), (unsupported,) if unsupported else (), (reason,) if reason else ())


def parse_gerber(
    path: str | os.PathLike[str],
    limits: GerberLimits | None = None,
    *,
    _post_parse_hook: Callable[[], None] | None = None,
    format_override: str | None = None,
    assume_linear: bool = False,
) -> GerberResult:
    source = Path(path); limits = limits or GerberLimits(); limits.validate()
    if not source.is_file():
        return _empty("blocked", "", 0, "source Gerber is missing or is not a regular file")
    before = source.stat(); digest = ''
    if before.st_size > limits.max_source_bytes:
        return _empty("blocked", digest, before.st_size, "source Gerber exceeds configured size limit")
    try:
        with source.open('rb') as handle:
            data = handle.read(limits.max_source_bytes + 1)
        if len(data) > limits.max_source_bytes:
            return _empty('blocked', '', len(data), 'source Gerber exceeds configured size limit')
        digest = sha256(data).hexdigest()
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return _empty("unsupported", digest, before.st_size, unsupported="INVALID_UTF8_SOURCE")
    except OSError:
        return _empty('blocked', digest, before.st_size, 'Source could not be read')
    if format_override is not None and (not isinstance(format_override, str) or not FS_RE.fullmatch(format_override)):
        return _empty('blocked', digest, len(data), 'Invalid coordinate-format override')
    if any(ord(c) < 32 and c not in '\t\r\n' for c in text):
        return _empty('blocked', digest, len(data), 'Invalid control character in Gerber source')

    units: Units = "unknown"; fmt: CoordinateFormat | None = None
    apertures: dict[int, GerberAperture] = {}; file_attrs: dict[str, tuple[str, ...]] = {}; aper_attrs: dict[str, tuple[str, ...]] = {}
    objects: list[GerberObject] = []; repeats: list[StepRepeat] = []; supported: set[str] = set(); unsupported: set[str] = set(); blocked: list[str] = []
    aperture: int | None = None; x: Decimal | None = None; y: Decimal | None = None; operation: int | None = None
    polarity: Literal["dark", "clear"] = "dark"; sr: tuple[int, int, Decimal, Decimal] | None = None
    object_id = 0; mo_seen = 0; fs_seen = 0; operation_seen = False; eof = False
    declared = None; linear = assume_linear; overrides = []; warnings = set(); sr_objects = []; metadata_entries = 0
    if assume_linear: overrides.append('Initial linear interpolation explicitly assumed by reviewer')
    if type(assume_linear) is not bool:
        return _empty('blocked', digest, len(data), 'Invalid linear interpolation override')

    def integer(token):
        if len(token) > 10 or not token.isascii() or not token.isdigit() or int(token) > 2147483647:
            raise _Blocked('integer exceeds supported range')
        return int(token)

    def coordinate_format(command):
        match = FS_RE.fullmatch(command)
        if not match: raise _Blocked('Malformed FS declaration or override')
        zero, notation, xi, xd, yi, yd = match.groups()
        if any(int(v) < 1 or int(v) > 6 for v in (xi, xd, yi, yd)):
            raise _Blocked('FS digits must be in the supported 1..6 range')
        return CoordinateFormat(zero, notation, int(xi), int(xd), int(yi), int(yd))

    parse_reached_end = False
    diagnostics = []; command_index = 0; source_command = ''; source_offset = 0; search_offset = 0
    def diagnostic(reason, details=None):
        if len(diagnostics) >= 20: return
        recovery = None
        if details and details.get('observedWidth') and fmt and fmt.zero_omission == 'L' and fmt.notation == 'A':
            # Widen capacity only. Decimal precision remains the source's stated
            # value; this is an interpretation to review, never proof of scale.
            xi = max(fmt.x_integer, details['observedWidth'] - fmt.x_decimal)
            yi = max(fmt.y_integer, details['observedWidth'] - fmt.y_decimal)
            if xi <= 6 and yi <= 6:
                recovery = {'format': f'FSLAX{xi}{fmt.x_decimal}Y{yi}{fmt.y_decimal}',
                            'basis': 'Minimum symmetric integer capacity for the observed token, retaining declared decimal precision under leading-zero omission.',
                            'qualification': 'hypothesis-only', 'initialInterpolation': 'unchanged; missing G01 remains held'}
        diagnostics.append({'reason': reason, 'commandNumber': command_index, 'command': source_command[:512],
                            'characterOffset': source_offset, 'line': text.count('\n', 0, source_offset) + 1,
                            'units': units, 'initialLinearAssumed': assume_linear, 'linearInterpolationEstablished': linear,
                            'declaredFormat': asdict(declared) if declared else None, 'effectiveFormat': asdict(fmt) if fmt else None,
                            **(details or {}), 'interpretationHypothesis': recovery,
                            'nextAction': 'Confirm decimal precision and interpolation with exporter metadata or independently registered source geometry. Review an explicit interpretation below; parsing alone does not qualify geometry. Other native/BOM work may continue.'})
    try:
        for command_index, (extended, command) in enumerate(_commands(text, limits), 1):
            source_command = command
            found = text.find(command, search_offset)
            source_offset = found if found >= 0 else search_offset
            search_offset = source_offset + len(command)
            if eof:
                blocked.append("commands appear after M02 end-of-file"); continue
            if extended:
                match = next(((p, c) for p, c in UNSUPPORTED_EXT.items() if command.startswith(p)), None)
                if match:
                    unsupported.add(match[1]); continue
                m = MO_RE.fullmatch(command)
                if m:
                    mo_seen += 1
                    if mo_seen > 1: blocked.append("MO must appear exactly once")
                    elif operation_seen: blocked.append("MO appears after an operation command")
                    else: units = "mm" if m.group(1) == "MM" else "in"; supported.add("MO")
                    continue
                m = FS_RE.fullmatch(command)
                if m:
                    fs_seen += 1
                    if fs_seen > 1: blocked.append("FS must appear exactly once"); continue
                    if operation_seen: raise _Blocked('FS appears after an operation')
                    declared = coordinate_format(command)
                    fmt = coordinate_format(format_override) if format_override else declared
                    if format_override and format_override != command: overrides.append('FS ' + command + ' -> ' + format_override)
                    if fmt.zero_omission != "L" or fmt.notation != "A": unsupported.add("UNSUPPORTED_FS_MODE")
                    supported.add("FS"); continue
                m = AD_RE.fullmatch(command)
                if m:
                    if len(apertures) >= limits.max_apertures: raise _Blocked("aperture count exceeds configured limit")
                    code = integer(m.group(1))
                    if code < 10: blocked.append("aperture D-code must be 10 or greater"); continue
                    if code in apertures: blocked.append(f"aperture D{code} is defined more than once"); continue
                    raw_values = (m.group(3) or '').split('X', 4)
                    if len(raw_values) > 4: raise _Blocked('Too many aperture parameters')
                    values = tuple(_num(v, limits) for v in raw_values)
                    template = m.group(2)
                    if len(values) not in {'C': (1, 2), 'R': (2, 3), 'O': (2, 3), 'P': (2, 3, 4)}[template]:
                        raise _Blocked('Invalid standard aperture parameter count')
                    if values[0] < 0 or (template != 'C' and values[0] == 0) or (template in ('R', 'O') and values[1] <= 0):
                        raise _Blocked('Invalid aperture dimensions')
                    if template == 'P' and (values[1] != int(values[1]) or not 3 <= values[1] <= 12):
                        raise _Blocked('Polygon aperture needs 3..12 integer vertices')
                    hole_index = {'C': 1, 'R': 2, 'O': 2, 'P': 3}[template]
                    if len(values) > hole_index:
                        hole = values[hole_index]
                        if hole <= 0 or hole >= min(values[:2] if template in ('R', 'O') else values[:1]):
                            raise _Blocked('Aperture hole does not fit')
                        unsupported.add('APERTURE_HOLE_GEOMETRY')
                    params = tuple(_txt(v) for v in values)
                    metadata_entries += len(aper_attrs)
                    if metadata_entries > limits.max_metadata_entries: raise _Blocked('Aperture metadata exceeds cumulative limit')
                    apertures[code] = GerberAperture(code, m.group(2), params, _attrs(aper_attrs)); supported.add("AD_" + m.group(2)); continue
                if command in {"LPD", "LPC"}:
                    polarity = "dark" if command == "LPD" else "clear"; supported.add("LP"); continue
                m = SR_RE.fullmatch(command)
                if m:
                    if sr is not None: raise _Blocked('Nested SR blocks are unsupported')
                    xc, yc = integer(m.group(1)), integer(m.group(2)); istep, jstep = _num(m.group(3), limits), _num(m.group(4), limits)
                    if xc < 1 or yc < 1: blocked.append("SR repeat counts must be positive"); continue
                    if istep < 0 or jstep < 0: raise _Blocked('SR steps cannot be negative')
                    if xc * yc > limits.max_sr_expansion: raise _Blocked("SR expansion exceeds configured limit")
                    sr = (xc, yc, istep, jstep); repeats.append(StepRepeat(xc, yc, _txt(istep), _txt(jstep))); supported.add("SR"); continue
                if command == "SR":
                    if sr is None: raise _Blocked('SR end has no active repeat block')
                    if len(objects) + len(sr_objects) * sr[0] * sr[1] > limits.max_objects: raise _Blocked('object count exceeds configured limit')
                    for ix in range(sr[0]):
                        for iy in range(sr[1]):
                            dx, dy = sr[2] * ix, sr[3] * iy
                            for item in sr_objects:
                                objects.append(replace(item, instance_id=f'{item.instance_id}:sr-{ix}-{iy}', sr_instance=(ix, iy),
                                    start_x=None if item.start_x is None else _txt(Decimal(item.start_x) + dx), start_y=None if item.start_y is None else _txt(Decimal(item.start_y) + dy),
                                    end_x=_txt(Decimal(item.end_x) + dx), end_y=_txt(Decimal(item.end_y) + dy)))
                    sr = None; sr_objects = []; x = y = None; operation = None; supported.add('SR'); continue
                if command.startswith('LN'):
                    if len(command) > limits.max_attribute_length: raise _Blocked('Layer name exceeds configured limit')
                    warnings.add('Deprecated LN layer-name metadata preserved only in source bytes'); continue
                m = ATTR_RE.fullmatch(command)
                if m:
                    if len(command) > limits.max_attribute_length: raise _Blocked("attribute exceeds configured length limit")
                    target = file_attrs if m.group(1) == "TF" else aper_attrs
                    if len(file_attrs) + len(aper_attrs) >= limits.max_metadata_entries: raise _Blocked('Attribute dictionary exceeds limit')
                    target[m.group(2)] = tuple(m.group(3).split(",")) if m.group(3) else (); supported.add(m.group(1)); continue
                if command == "TD": aper_attrs.clear(); supported.add("TD"); continue
                if command.startswith("TD."): aper_attrs.pop(command[3:], None); supported.add("TD"); continue
                unsupported.add("UNKNOWN_EXTENDED_COMMAND"); continue

            if command.startswith("G04"):
                if len(command) > limits.max_comment_length: raise _Blocked("comment exceeds configured length limit")
                supported.add("G04"); continue
            if command == "M02":
                if sr is not None: raise _Blocked('SR block is not closed before EOF')
                eof = True; supported.add("M02"); continue
            if command == 'G75': supported.add('G75'); continue
            if len(command) > 5 * limits.max_numeric_token_length + 20: raise _Blocked('Geometry command exceeds length limit')
            bad = next((code for prefix, code in UNSUPPORTED_NORMAL if command.startswith(prefix)), None)
            if bad: unsupported.add(bad); continue
            if command in {"G01", "G1"}: linear = True; supported.add("G01"); continue
            if command.startswith("G01"): linear = True; supported.add("G01"); command = command[3:]
            elif command.startswith("G1"): linear = True; supported.add("G01"); command = command[2:]
            if re.fullmatch(r'G54D\d+', command): command = command[3:]; warnings.add('Deprecated G54 aperture selection read')
            m = D_RE.fullmatch(command)
            if m:
                code = integer(m.group(1))
                if code >= 10:
                    if code not in apertures: raise _Blocked('Aperture selection precedes its definition')
                    aperture = code; operation = None; supported.add("D_SELECT"); continue
                if code not in {1, 2, 3}: unsupported.add("UNKNOWN_D_CODE"); continue
            if not command.isascii() or not re.fullmatch(r'(?:X[+-]?[0-9]+)?(?:Y[+-]?[0-9]+)?(?:I[+-]?[0-9]+)?(?:J[+-]?[0-9]+)?(?:D[0-9]+)?', command):
                unsupported.add('UNKNOWN_COMMAND'); continue
            fields = FIELD_RE.findall(command)
            if not fields or "".join(k + v for k, v in fields) != command:
                unsupported.add("UNKNOWN_COMMAND"); continue
            mapping: dict[str, str] = {}
            if any(k in mapping or mapping.setdefault(k, v) != v for k, v in fields):
                blocked.append("coordinate command repeats a field"); continue
            if "I" in mapping or "J" in mapping: unsupported.add("ARC_OFFSETS_WITHOUT_SUPPORTED_ARC"); continue
            if fmt is None: blocked.append("coordinate operation encountered before FS"); continue
            if units == "unknown": blocked.append("coordinate operation encountered before MO"); continue
            op = integer(mapping["D"]) if "D" in mapping else operation
            if op is None: blocked.append("coordinate operation has no D01/D02/D03 state"); continue
            if op >= 10: blocked.append("aperture selection cannot be combined with coordinate operation"); continue
            if op not in {1, 2, 3}: unsupported.add("UNKNOWN_D_CODE"); continue
            operation = 1 if op == 1 else None; operation_seen = True
            nx, ny = x, y
            if "X" in mapping: nx = _coord(mapping["X"], fmt.x_integer, fmt.x_decimal, fmt.zero_omission, limits)
            if "Y" in mapping: ny = _coord(mapping["Y"], fmt.y_integer, fmt.y_decimal, fmt.zero_omission, limits)
            if nx is None or ny is None: blocked.append("coordinate operation does not establish both X and Y"); continue
            if op == 2: x, y = nx, ny; supported.add("D02"); continue
            if aperture is None: blocked.append("drawing operation has no selected aperture"); x, y = nx, ny; continue
            if aperture not in apertures: blocked.append(f"selected aperture D{aperture} is undefined"); x, y = nx, ny; continue
            if op == 1 and (x is None or y is None): blocked.append("D01 draw has no prior current point"); x, y = nx, ny; continue
            if op == 1 and not linear:
                reason = 'D01 draw requires explicit G01; initial interpolation is unspecified'
                blocked.append(reason); diagnostic(reason); x, y = nx, ny; continue
            if op == 1 and apertures[aperture].template != 'C': unsupported.add('NON_CIRCULAR_APERTURE_DRAW'); x, y = nx, ny; continue
            object_id += 1; base_x, base_y = (x, y) if op == 1 else (None, None)
            target = objects if sr is None else sr_objects
            if len(objects) + len(sr_objects) >= limits.max_objects: raise _Blocked("object count exceeds configured limit")
            target.append(GerberObject(object_id, f'obj-{object_id:06d}', "draw" if op == 1 else "flash", aperture, polarity, None if base_x is None else _txt(base_x), None if base_y is None else _txt(base_y), _txt(nx), _txt(ny), None))
            x, y = nx, ny; supported.add("D01" if op == 1 else "D03")
        parse_reached_end = True
    except _Blocked as exc:
        blocked.append(str(exc)); diagnostic(str(exc), exc.details)

    # An early failure leaves subsequent commands unassessed. It cannot establish
    # that a declaration or EOF command is absent from the complete source.
    if parse_reached_end:
        if not mo_seen: blocked.append("MO unit declaration is required")
        if not fs_seen: blocked.append("FS coordinate format is required")
        if not eof: blocked.append("M02 end-of-file command is required")
    if _post_parse_hook: _post_parse_hook()
    try:
        after = source.stat()
        with source.open('rb') as handle: fresh = handle.read(limits.max_source_bytes + 1)
        if after.st_size != before.st_size or sha256(fresh).hexdigest() != digest: blocked.append("source Gerber changed during parsing")
    except OSError: blocked.append('source Gerber changed during parsing')
    status: Status = "blocked" if blocked else "unsupported" if unsupported else "success"
    result = GerberResult(status, digest, len(data), "0.2", units, fmt, "gerber-source-native", _attrs(file_attrs), tuple(apertures[k] for k in sorted(apertures)), tuple(objects) if status == 'success' else (), tuple(repeats), tuple(sorted(supported)), tuple(sorted(unsupported)), tuple(dict.fromkeys(blocked)), declared, tuple(overrides), tuple(sorted(warnings)), status == 'success', tuple(diagnostics))
    if len(json.dumps(result.to_dict(), ensure_ascii=True)) > 16_000_000:
        return _empty('blocked', digest, len(data), 'serialized Gerber output exceeds 16 MB limit')
    return result
