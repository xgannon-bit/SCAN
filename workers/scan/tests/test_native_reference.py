from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
import zipfile
from workers.scan.native_reference import prepare_reference


class ReferenceTests(unittest.TestCase):
    def test_exact_source_payload_determinism_and_existing_output_protection(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'original.zip'
            with zipfile.ZipFile(source,'w') as archive:
                archive.writestr('Fictional/Fictional','<unqualified>synthetic</unqualified>')
                archive.writestr('Fictional/Images/',b''); archive.writestr('Fictional/Images/example.bin',b'\x00\xffkeep')
            original=source.read_bytes(); digest=sha256(original).hexdigest()
            review={'status':'success','artifactType':'scan.archive-review','machineExportAllowed':False,'preflight':{'source':{'sha256':digest,'size':len(original)}}}
            a=prepare_reference(source,root/'one.zip',review); b=prepare_reference(source,root/'two.zip',review)
            self.assertEqual(a,b); self.assertFalse(a['nativeEditsApplied'])
            with zipfile.ZipFile(root/'one.zip') as archive: self.assertEqual(archive.read('NATIVE_SOURCE.zip'),original)
            self.assertEqual(source.read_bytes(),original)
            with self.assertRaises(FileExistsError): prepare_reference(source,root/'one.zip',review)
            review['preflight']['source']['sha256']='0'*64
            with self.assertRaises(ValueError): prepare_reference(source,root/'stale.zip',review)
            self.assertFalse((root/'stale.zip').exists())


if __name__ == '__main__': unittest.main()
