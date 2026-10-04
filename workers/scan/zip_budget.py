"""Bound central-directory work before stdlib ZipFile allocates ZipInfo objects."""
from pathlib import Path
from contextlib import nullcontext
import struct
from typing import BinaryIO
import zipfile


class ZipBudgetExceeded(ValueError):
    pass


def check_zip_directory(path: Path | BinaryIO, max_entries: int, max_directory_bytes: int = 16_000_000) -> None:
    """Require a single ordinary ZIP directory; fail closed on ZIP64 end records.

    This is a resource preflight, not a replacement ZIP decoder. ZipFile still
    validates/reads every accepted payload. Names are skipped, never extracted.
    """
    with (path.open('rb') if isinstance(path, Path) else nullcontext(path)) as stream:
        stream.seek(0, 2)
        size = stream.tell()
        tail_start = max(0, size - 65557)
        stream.seek(tail_start)
        tail = stream.read(65557)
        end = tail.rfind(b'PK\x05\x06')
        if end < 0 or end + 22 > len(tail):
            raise zipfile.BadZipFile('ZIP end directory is missing or truncated.')
        disk, directory_disk, disk_count, count, directory_size, offset, comment_size = struct.unpack_from('<4H2IH', tail, end + 4)
        eocd_offset = tail_start + end
        if end + 22 + comment_size != len(tail) or disk or directory_disk or disk_count != count:
            raise zipfile.BadZipFile('Unsupported split ZIP, trailing data or malformed end directory.')
        if count == 0xffff or directory_size == 0xffffffff or offset == 0xffffffff:
            raise zipfile.BadZipFile('ZIP64 end directories are not supported by the bounded preflight.')
        if eocd_offset >= 20:
            stream.seek(eocd_offset - 20)
            if stream.read(4) == b'PK\x06\x07':
                raise zipfile.BadZipFile('ZIP64 end directories are not supported by the bounded preflight.')
        if count > max_entries:
            raise ZipBudgetExceeded('ZIP central directory entry count exceeds its configured limit.')
        if directory_size > max_directory_bytes:
            raise ZipBudgetExceeded('ZIP central directory metadata exceeds its byte limit.')
        if offset + directory_size != eocd_offset:
            raise zipfile.BadZipFile('ZIP directory offsets do not describe a supported ordinary archive.')
        stream.seek(offset)
        directory_end = offset + directory_size
        actual_count = 0
        while stream.tell() < directory_end:
            header = stream.read(46)
            if len(header) != 46 or header[:4] != b'PK\x01\x02':
                raise zipfile.BadZipFile('ZIP central directory record is malformed.')
            name_size, extra_size, entry_comment_size = struct.unpack_from('<3H', header, 28)
            actual_count += 1
            if actual_count > max_entries:
                raise ZipBudgetExceeded('Actual ZIP directory entry count exceeds its limit.')
            next_offset = stream.tell() + name_size + extra_size + entry_comment_size
            if next_offset > directory_end:
                raise zipfile.BadZipFile('ZIP directory record extends beyond the declared directory.')
            stream.seek(next_offset)
        if actual_count != count or stream.tell() != directory_end:
            raise zipfile.BadZipFile('ZIP directory count or length disagrees with actual records.')
