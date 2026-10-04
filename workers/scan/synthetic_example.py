"""Wholly authored fixture. Its XML is deliberately NOT an Eagle/Athena schema."""
from pathlib import Path
import zipfile


def write_example(destination: Path) -> None:
    members = {
        "CedarGroup/Cedar7/Cedar7.xml": b'<synthetic-job name="Cedar7" revision="main" native-compatible="false" />\n',
        "CedarGroup/Cedar7/Cedar7_Temp.xml": b'<synthetic-job name="Cedar7" revision="temp" native-compatible="false" />\n',
        "CedarGroup/Cedar7/Cedar7.xml.bak": b'<synthetic-job name="Cedar7" revision="backup" native-compatible="false" />\n',
        "CedarGroup/Master/Master.xml": b'<synthetic-master revision="main" native-compatible="false" />\n',
        "CedarGroup/Master/Master_Temp.xml": b'<synthetic-master revision="temp" native-compatible="false" />\n',
        "README.txt": b"Wholly synthetic SCAN intake fixture. Not a machine job. No teaching, geometry or release evidence.\n",
    }
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_STORED) as archive:
        for name, content in members.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            archive.writestr(info, content)
