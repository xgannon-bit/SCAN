"""Read one explicitly selected preserved raster. No registration or native edits."""
from hashlib import sha256
from pathlib import Path
import struct
import zipfile

MAX_BYTES = 32_000_000
MAX_PIXELS = 80_000_000


def image_metadata(data):
    if not data or len(data) > MAX_BYTES:
        raise ValueError('Image exceeds the 32 MB bound.')
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 33 and data[12:16] == b'IHDR':
        width, height = struct.unpack('>II', data[16:24])
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8'):
        pos, width, height = 2, 0, 0
        while pos < len(data):
            if data[pos] != 255:
                raise ValueError('Invalid JPEG header.')
            while pos < len(data) and data[pos] == 255:
                pos += 1
            if pos >= len(data):
                break
            marker = data[pos]; pos += 1
            if marker in (0xD9, 0xDA):
                break
            if marker == 0x01 or 0xD0 <= marker <= 0xD8:
                continue
            if pos + 2 > len(data):
                break
            length = int.from_bytes(data[pos:pos + 2], 'big')
            if length < 2 or pos + length > len(data):
                raise ValueError('Truncated JPEG header.')
            if marker in (0xC0, 0xC1, 0xC2):
                if length < 8:
                    raise ValueError('Invalid JPEG frame.')
                height, width = struct.unpack('>HH', data[pos + 3:pos + 7])
                break
            pos += length
        mime = 'image/jpeg'
    elif data.startswith(b'BM') and len(data) >= 54 and int.from_bytes(data[14:18], 'little') >= 40:
        width, height = struct.unpack('<ii', data[18:26]); height = abs(height)
        mime = 'image/bmp'
    else:
        raise ValueError('Supported scan previews are PNG, JPEG and BMP. TIFF and proprietary formats need an explicit decoder; no image registration is inferred.')
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS or max(width, height) > 40000:
        raise ValueError('Image dimensions exceed the 80-megapixel preview bound.')
    return {'width': width, 'height': height, 'mime': mime, 'size': len(data), 'sha256': sha256(data).hexdigest()}


def read_preserved_image(source, report, member):
    from .image_catalog import image_role
    if not isinstance(member, str) or len(member) > 2048 or not image_role(member, report['selection']):
        raise ValueError('Select an image in the explicit job root or selected Master image directories.')
    matches = [f for f in report['preservedFiles'] if f['originalName'] == member]
    if len(matches) != 1 or not 0 < matches[0]['size'] <= MAX_BYTES:
        raise ValueError('Image is missing, ambiguous or exceeds its preview bound.')
    with zipfile.ZipFile(source) as archive:
        data = archive.read(member)
    if len(data) != matches[0]['size'] or sha256(data).hexdigest() != matches[0]['sha256']:
        raise ValueError('Image bytes differ from the verified snapshot.')
    metadata = image_metadata(data)
    destination = Path(source).parent / 'result.image'
    with destination.open('xb') as output:
        output.write(data)
    return {'status': 'success', 'artifactType': 'scan.preserved-image', 'registration': 'unregistered', 'sourceSha256': report['source']['sha256'], 'member': member, **metadata, 'machineExportAllowed': False}
