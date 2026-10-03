from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
import os
import re
from typing import Callable, Literal

Status = Literal["success", "blocked", "unsupported"]
Units = Literal["mm", "in", "unknown"]


@dataclass(frozen=True)
class GerberLimits:
    max_source_bytes: int = 20_000_000
    max_commands: int = 500_000
    max_apertures: int = 10_000
    max_objects: int = 2_000_000
    max_sr_expansion: int = 100_000
    max_numeric_token_length: int = 64
    max_attribute_length: int = 2_048
    max_comment_length: int = 4_096

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

    def to_dict(self) -> dict:
        return asdict(self)


class _Blocked(Exception):
    pass


FS_RE = re.compile(r"^FS([LT])([AI])X(\d)(\d)Y(\d)(\d)$")
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
    try:
        value = Decimal(token)
    except InvalidOperation as exc:
        raise _Blocked("invalid numeric token") from exc
    if not value.is_finite():
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
        raise _Blocked("coordinate token exceeds declared FS width")
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
    return GerberResult(status, digest, size, "0.1", "unknown", None, "gerber-source-native", (), (), (), (), (), (unsupported,) if unsupported else (), (reason,) if reason else ())


def parse_gerber(
    path: str | os.PathLike[str],
    limits: GerberLimits | None = None,
    *,
    _post_parse_hook: Callable[[], None] | None = None,
) -> GerberResult:
    source = Path(path); limits = limits or GerberLimits(); limits.validate()
    if not source.is_file():
        return _empty("blocked", "", 0, "source Gerber is missing or is not a regular file")
    before = source.stat(); digest = _hash(source)
    if before.st_size > limits.max_source_bytes:
        return _empty("blocked", digest, before.st_size, "source Gerber exceeds configured size limit")
    try:
        text = source.read_bytes().decode("ascii")
    except UnicodeDecodeError:
        return _empty("unsupported", digest, before.st_size, unsupported="NON_ASCII_SOURCE")

    units: Units = "unknown"; fmt: CoordinateFormat | None = None
    apertures: dict[int, GerberAperture] = {}; file_attrs: dict[str, tuple[str, ...]] = {}; aper_attrs: dict[str, tuple[str, ...]] = {}
    objects: list[GerberObject] = []; repeats: list[StepRepeat] = []; supported: set[str] = set(); unsupported: set[str] = set(); blocked: list[str] = []
    aperture: int | None = None; x: Decimal | None = None; y: Decimal | None = None; operation: int | None = None
    polarity: Literal["dark", "clear"] = "dark"; sr: tuple[int, int, Decimal, Decimal] | None = None
    object_id = 0; mo_seen = 0; fs_seen = 0; operation_seen = False; eof = False

    try:
        for extended, command in _commands(text, limits):
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
                    zero, notation, xi, xd, yi, yd = m.groups()
                    if zero != "L" or notation != "A": unsupported.add("UNSUPPORTED_FS_MODE")
                    fmt = CoordinateFormat(zero, notation, int(xi), int(xd), int(yi), int(yd)); supported.add("FS"); continue
                m = AD_RE.fullmatch(command)
                if m:
                    if len(apertures) >= limits.max_apertures: raise _Blocked("aperture count exceeds configured limit")
                    code = int(m.group(1))
                    if code < 10: blocked.append("aperture D-code must be 10 or greater"); continue
                    if code in apertures: blocked.append(f"aperture D{code} is defined more than once"); continue
                    params = tuple(_txt(_num(v, limits)) for v in (m.group(3) or "").split("X") if v)
                    apertures[code] = GerberAperture(code, m.group(2), params, _attrs(aper_attrs)); supported.add("AD_" + m.group(2)); continue
                if command in {"LPD", "LPC"}:
                    polarity = "dark" if command == "LPD" else "clear"; supported.add("LP"); continue
                m = SR_RE.fullmatch(command)
                if m:
                    xc, yc = int(m.group(1)), int(m.group(2)); istep, jstep = _num(m.group(3), limits), _num(m.group(4), limits)
                    if xc < 1 or yc < 1: blocked.append("SR repeat counts must be positive"); continue
                    if xc * yc > limits.max_sr_expansion: raise _Blocked("SR expansion exceeds configured limit")
                    sr = (xc, yc, istep, jstep); repeats.append(StepRepeat(xc, yc, _txt(istep), _txt(jstep))); supported.add("SR"); continue
                if command == "SR": sr = None; supported.add("SR"); continue
                m = ATTR_RE.fullmatch(command)
                if m:
                    if len(command) > limits.max_attribute_length: raise _Blocked("attribute exceeds configured length limit")
                    target = file_attrs if m.group(1) == "TF" else aper_attrs
                    target[m.group(2)] = tuple(m.group(3).split(",")) if m.group(3) else (); supported.add(m.group(1)); continue
                if command == "TD": aper_attrs.clear(); supported.add("TD"); continue
                if command.startswith("TD."): aper_attrs.pop(command[3:], None); supported.add("TD"); continue
                unsupported.add("UNKNOWN_EXTENDED_COMMAND"); continue

            if command.startswith("G04"):
                if len(command) > limits.max_comment_length: raise _Blocked("comment exceeds configured length limit")
                supported.add("G04"); continue
            if command == "M02": eof = True; supported.add("M02"); continue
            bad = next((code for prefix, code in UNSUPPORTED_NORMAL if command.startswith(prefix)), None)
            if bad: unsupported.add(bad); continue
            if command in {"G01", "G1"}: supported.add("G01"); continue
            if command.startswith("G01"): supported.add("G01"); command = command[3:]
            elif command.startswith("G1"): supported.add("G01"); command = command[2:]
            m = D_RE.fullmatch(command)
            if m:
                code = int(m.group(1))
                if code >= 10: aperture = code; supported.add("D_SELECT")
                elif code in {1, 2, 3}: operation = code
                else: unsupported.add("UNKNOWN_D_CODE")
                continue
            fields = FIELD_RE.findall(command)
            if not fields or "".join(k + v for k, v in fields) != command:
                unsupported.add("UNKNOWN_COMMAND"); continue
            mapping: dict[str, str] = {}
            if any(k in mapping or mapping.setdefault(k, v) != v for k, v in fields):
                blocked.append("coordinate command repeats a field"); continue
            if "I" in mapping or "J" in mapping: unsupported.add("ARC_OFFSETS_WITHOUT_SUPPORTED_ARC"); continue
            if fmt is None: blocked.append("coordinate operation encountered before FS"); continue
            if units == "unknown": blocked.append("coordinate operation encountered before MO"); continue
            op = int(mapping["D"]) if "D" in mapping else operation
            if op is None: blocked.append("coordinate operation has no D01/D02/D03 state"); continue
            if op >= 10: blocked.append("aperture selection cannot be combined with coordinate operation"); continue
            if op not in {1, 2, 3}: unsupported.add("UNKNOWN_D_CODE"); continue
            operation = op; operation_seen = True
            nx, ny = x, y
            if "X" in mapping: nx = _coord(mapping["X"], fmt.x_integer, fmt.x_decimal, fmt.zero_omission, limits)
            if "Y" in mapping: ny = _coord(mapping["Y"], fmt.y_integer, fmt.y_decimal, fmt.zero_omission, limits)
            if nx is None or ny is None: blocked.append("coordinate operation does not establish both X and Y"); continue
            if op == 2: x, y = nx, ny; supported.add("D02"); continue
            if aperture is None: blocked.append("drawing operation has no selected aperture"); x, y = nx, ny; continue
            if aperture not in apertures: blocked.append(f"selected aperture D{aperture} is undefined"); x, y = nx, ny; continue
            if op == 1 and (x is None or y is None): blocked.append("D01 draw has no prior current point"); x, y = nx, ny; continue
            object_id += 1; base_x, base_y = (x, y) if op == 1 else (None, None)
            instances = [(0, 0, Decimal(0), Decimal(0))] if sr is None else [(ix, iy, sr[2] * ix, sr[3] * iy) for iy in range(sr[1]) for ix in range(sr[0])]
            if len(objects) + len(instances) > limits.max_objects: raise _Blocked("object count exceeds configured limit")
            for ix, iy, dx, dy in instances:
                sri = None if sr is None else (ix, iy); ident = f"obj-{object_id:06d}" if sri is None else f"obj-{object_id:06d}:sr-{ix}-{iy}"
                objects.append(GerberObject(object_id, ident, "draw" if op == 1 else "flash", aperture, polarity, None if base_x is None else _txt(base_x + dx), None if base_y is None else _txt(base_y + dy), _txt(nx + dx), _txt(ny + dy), sri))
            x, y = nx, ny; supported.add("D01" if op == 1 else "D03")
    except _Blocked as exc:
        blocked.append(str(exc))

    if not mo_seen: blocked.append("MO unit declaration is required")
    if not fs_seen: blocked.append("FS coordinate format is required")
    if not eof: blocked.append("M02 end-of-file command is required")
    if _post_parse_hook: _post_parse_hook()
    after = source.stat()
    if after.st_size != before.st_size or _hash(source) != digest: blocked.append("source Gerber changed during parsing")
    status: Status = "blocked" if blocked else "unsupported" if unsupported else "success"
    return GerberResult(status, digest, before.st_size, "0.1", units, fmt, "gerber-source-native", _attrs(file_attrs), tuple(apertures[k] for k in sorted(apertures)), tuple(objects), tuple(repeats), tuple(sorted(supported)), tuple(sorted(unsupported)), tuple(dict.fromkeys(blocked)))
