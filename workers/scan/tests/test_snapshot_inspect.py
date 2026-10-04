"""Wholly authored snapshots; no native vendor schema or private regression oracle."""
from dataclasses import replace
from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import warnings
from unittest.mock import patch
import zipfile

from workers.scan import snapshot_inspect as reader
from workers.scan.snapshot_capture import SnapshotSelection, capture_snapshot
from workers.scan.job_intake import inventory_zip


class SnapshotInspectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / 'authored.zip'
        self.snapshot = self.root / 'authored.scan-snapshot'
        self.members = {
            'Fictional/Board/Board.xml': b'<?xml version="1.0"?><FictionalJob version="invented-1"><FormatVersion>example-2</FormatVersion><Opaque token="preserve">NOT A NATIVE JOB</Opaque></FictionalJob>',
            'Fictional/Board/Board_Temp.xml': b'<FictionalTemp />',
            'Fictional/Board/Board.xml.bak': b'<FictionalBackup />',
            'Fictional/Master/Master.xml': b'<FictionalMaster><Unknown /></FictionalMaster>',
            'Fictional/Master/Master_Temp.xml': b'<FictionalTempMaster />',
            'Fictional/Board/camera.jpg': b'fictional opaque image bytes, not a photograph',
            'Fictional/Board/old.his': b'fictional history',
            'Fictional/Master/unrecognized.asset': b'preserve without interpretation',
        }
        self.selection = SnapshotSelection('Fictional/Board', 'Fictional/Board/Board.xml', 'main', 'Fictional/Master/Master.xml', 'main')
        self.capture()

    def tearDown(self): self.temp.cleanup()

    def capture(self, selection=None):
        with zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_STORED) as z:
            for name, content in self.members.items(): z.writestr(name, content)
        if self.snapshot.exists(): self.snapshot.unlink()
        captured = capture_snapshot(self.archive, self.snapshot, sha256(self.archive.read_bytes()).hexdigest(), selection or self.selection)
        self.assertEqual(captured.status, 'success', captured)
        self.expected = captured.package_sha256

    def inspect(self, **kwargs):
        return reader.inspect_snapshot(self.snapshot, kwargs.pop('expected', self.expected), **kwargs)

    def mutate(self, transformation):
        with zipfile.ZipFile(self.snapshot) as z: files = {i.filename: z.read(i) for i in z.infolist()}
        transformation(files)
        with zipfile.ZipFile(self.snapshot, 'w', compression=zipfile.ZIP_STORED) as z:
            for name, content in files.items(): z.writestr(name, content)
        self.expected = sha256(self.snapshot.read_bytes()).hexdigest()

    def edit_manifest(self, transform):
        def edit(files):
            value = json.loads(files['manifest.json']); transform(value)
            files['manifest.json'] = json.dumps(value).encode()
        self.mutate(edit)

    def test_capture_inspect_roundtrip_preserves_bytes_and_has_no_native_authority(self):
        original = self.snapshot.read_bytes()
        report = self.inspect()
        self.assertEqual(report['status'], 'success', report)
        self.assertEqual(report['integrity']['status'], 'verified-against-capture-hash')
        self.assertEqual(len(report['preservedFiles']), len(self.members))
        self.assertEqual(report['xmlEnvelopes']['job']['rootName'], 'FictionalJob')
        self.assertEqual(report['xmlEnvelopes']['job']['versionClaims'][0]['claim'], 'invented-1')
        self.assertEqual(report['xmlEnvelopes']['job']['elementCount'], 3)
        self.assertIsNone(report['readiness']['packageComplete'])
        self.assertTrue(all(v is None for v in report['coverage'].values()))
        self.assertIsNone(report['dependencyGraph'])
        self.assertIsNone(report['candidateId'])
        self.assertFalse(report['nativeSchemaSupported'])
        self.assertFalse(report['machineExportAllowed'])
        self.assertEqual(report['changes'], [])
        self.assertEqual(report, self.inspect())
        self.assertEqual(original, self.snapshot.read_bytes())
        self.assertEqual({p.name for p in self.root.iterdir()}, {'authored.zip', 'authored.scan-snapshot'})

    def test_record_failure_and_duplicate_scalars_enter_handoff_holds(self):
        for content, expected in ((b'<PartData><ID><Nested/></ID></PartData>', 'NATIVE_RECORDS_BLOCKED'), (b'<PartData><ID>A</ID><ID>B</ID></PartData>', 'NATIVE_SCALAR_AMBIGUITY')):
            with self.subTest(expected=expected):
                self.members[self.selection.job_member] = b'<JobContainer><JobXmlVersion>10.2</JobXmlVersion><PartDataList>' + content + b'</PartDataList></JobContainer>'
                self.capture()
                report = self.inspect()
                self.assertEqual(report['status'], 'success')
                self.assertTrue(report['integrity']['allArchivedFilesVerified'])
                self.assertTrue(any(hold['code'] == expected and hold['scope'] == 'job' for hold in report['holds']))

    def test_parse_error_reports_category_without_source_text(self):
        self.members[self.selection.job_member] = b'<Job><Name>DO_NOT_LOG & DO_NOT_LOG</Name></Job>'
        self.capture()
        report = self.inspect()
        envelope = report['xmlEnvelopes']['job']
        self.assertEqual(envelope['status'], 'blocked')
        self.assertIn('invalid token', envelope['reason'])
        self.assertNotIn('DO_NOT_LOG', envelope['reason'])
        self.assertTrue(any(hold['code'] == 'XML_REJECTED' and hold['scope'] == 'job' for hold in report['holds']))

    def test_legacy_root_inventory_is_verified_from_bytes_not_blindly_trusted(self):
        from dataclasses import asdict
        from workers.scan.job_intake import _discover_job_roots
        self.members['Fictional/Recovery/Recovery_Temp.xml'] = b'<Authored />'
        self.capture()
        old_roots = [asdict(root) for root in _discover_job_roots(inventory_zip(self.archive).entries, include_recovery=False)]
        self.edit_manifest(lambda manifest: manifest.update(jobRoots=old_roots))
        self.assertEqual(self.inspect()['status'], 'success')
        self.edit_manifest(lambda manifest: manifest['jobRoots'][0].update(job_name='invented-forgery'))
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_both_historical_candidate_inventories_verify_only_as_complete_derivations(self):
        self.members.update({
            'Fictional/Board/Board.his.bak': b'authored history backup',
            'Fictional/Board/Board.pat.bak': b'authored pattern backup',
            'Fictional/Board/nested/Board_Temp.xml': b'<AuthoredNested/>',
            'Fictional/Recovery/Recovery_Temp.xml': b'<AuthoredRecovery/>',
        })
        for recovery in (True, False):
            with self.subTest(recovery=recovery):
                self.capture()
                def historic(manifest):
                    board = next(root for root in manifest['jobRoots'] if root['root'] == 'Fictional/Board')
                    board['backup_candidates'] = ['Fictional/Board/Board.his.bak', 'Fictional/Board/Board.pat.bak', 'Fictional/Board/Board.xml.bak']
                    board['temp_candidates'] = ['Fictional/Board/Board_Temp.xml', 'Fictional/Board/nested/Board_Temp.xml']
                    if not recovery:
                        manifest['jobRoots'] = [board]
                self.edit_manifest(historic)
                report = self.inspect()
                self.assertEqual(report['status'], 'success', report)
                self.assertTrue(report['integrity']['allArchivedFilesVerified'])
                self.assertIn('Fictional/Board/Board.pat.bak', [m['path'] for m in report['preservedFiles']])
                self.edit_manifest(lambda m: m['jobRoots'][0]['backup_candidates'].remove('Fictional/Board/Board.his.bak'))
                self.assertEqual(self.inspect()['code'], 'INVENTORY_MISMATCH')

    def test_old_companion_or_nested_selection_must_be_reselected_not_xml_repaired(self):
        from dataclasses import asdict
        for member, role in [('Fictional/Board/Board.pat.bak', 'backup'), ('Fictional/Board/nested/Board_Temp.xml', 'temp')]:
            with self.subTest(member=member):
                self.members[member] = b'authored opaque bytes'
                self.capture()
                def obsolete(files):
                    manifest = json.loads(files['manifest.json'])
                    board = manifest['jobRoots'][0]
                    board[role + '_candidates'] = sorted(board[role + '_candidates'] + [member])
                    manifest['selection']['job'].update(member=member, role=role, sha256=sha256(self.members[member]).hexdigest(), size=len(self.members[member]))
                    chosen = replace(self.selection, job_member=member, job_role=role)
                    identity = {'archiveSha256': manifest['source']['sha256'], 'selection': asdict(chosen)}
                    manifest['snapshotId'] = sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                    files['selected/job.bin'] = self.members[member]
                    files['manifest.json'] = json.dumps(manifest).encode()
                self.mutate(obsolete)
                report = self.inspect()
                self.assertEqual(report['code'], 'INVALID_SELECTION', report)
                self.assertIn('Inventory the source again', report['reasons'][0])
                self.assertFalse(report['machineExportAllowed'])

    def test_small_high_ratio_member_survives_capture_and_full_asset_verification(self):
        member = 'Fictional/Board/authored-repetitive.bin'
        self.members[member] = b'A' * 900_000
        with zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in self.members.items(): archive.writestr(name, content)
        self.snapshot.unlink()
        receipt = capture_snapshot(self.archive, self.snapshot, sha256(self.archive.read_bytes()).hexdigest(), self.selection)
        self.assertEqual(receipt.status, 'success')
        report = self.inspect(expected=receipt.package_sha256)
        actual = next(file for file in report['preservedFiles'] if file['path'] == member)
        self.assertEqual(actual['sha256'], sha256(self.members[member]).hexdigest())

    def test_inspection_works_without_original_source_and_never_follows_native_paths(self):
        self.members['Fictional/Board/Board.xml'] = b'<FictionalJob><Asset>file:///missing/private.jpg</Asset></FictionalJob>'
        self.capture(); self.archive.unlink()
        report = self.inspect()
        self.assertEqual(report['status'], 'success')
        self.assertNotIn('file:///missing', json.dumps(report))
        self.assertEqual(report['xmlEnvelopes']['job']['semanticInterpretation'], 'unsupported')

    def test_explicit_temp_backup_and_master_roles_are_not_merged(self):
        for role, suffix, root in [('temp', '_Temp.xml', 'FictionalTemp'), ('backup', '.xml.bak', 'FictionalBackup')]:
            self.capture(replace(self.selection, job_member='Fictional/Board/Board' + suffix, job_role=role, master_member='Fictional/Master/Master_Temp.xml', master_role='temp'))
            report = self.inspect()
            self.assertEqual(report['selection']['job']['role'], role)
            self.assertEqual(report['selection']['master']['role'], 'temp')
            self.assertEqual(report['xmlEnvelopes']['job']['rootName'], root)

    def test_missing_master_remains_an_explicit_hold(self):
        self.capture(replace(self.selection, master_member=None, master_role=None))
        report = self.inspect()
        self.assertEqual(report['status'], 'success')
        self.assertIsNone(report['selection']['master'])
        self.assertIn('MASTER_NOT_SELECTED', [h['code'] for h in report['holds']])

    def test_selected_payload_tampering_is_rejected(self):
        self.mutate(lambda files: files.update({'selected/job.bin': b'<changed/>'}))
        self.assertEqual(self.inspect()['code'], 'SELECTED_MISMATCH')

    def test_source_payload_tampering_is_rejected(self):
        self.mutate(lambda files: files.update({'source/archive.zip': b'changed'}))
        self.assertEqual(self.inspect()['code'], 'SOURCE_MISMATCH')

    def test_unselected_asset_change_detected_even_if_source_hash_is_rewritten(self):
        def edit(files):
            source = io.BytesIO(files['source/archive.zip']); output = io.BytesIO()
            with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(output, 'w') as outgoing:
                for name in incoming.namelist(): outgoing.writestr(name, b'changed' if name.endswith('.jpg') else incoming.read(name))
            files['source/archive.zip'] = output.getvalue()
            manifest = json.loads(files['manifest.json'])
            manifest['source'].update(sha256=sha256(output.getvalue()).hexdigest(), size=len(output.getvalue()))
            files['manifest.json'] = json.dumps(manifest).encode()
        self.mutate(edit)
        self.assertEqual(self.inspect()['code'], 'INVENTORY_MISMATCH')

    def test_forged_members_roots_holds_and_id_are_recomputed(self):
        for field, value, code in [('members', [], 'INVENTORY_MISMATCH'), ('jobRoots', [], 'INVENTORY_MISMATCH'), ('holds', ['invented'], 'INVENTORY_MISMATCH'), ('snapshotId', '0'*64, 'IDENTITY_MISMATCH')]:
            with self.subTest(field=field):
                self.capture(); self.edit_manifest(lambda m: m.update({field: value}))
                self.assertEqual(self.inspect()['code'], code)

    def test_forged_roles_and_stored_paths_are_rejected(self):
        for key, value, code in [('role', 'temp', 'INVALID_SELECTION'), ('storedPath', '../job.xml', 'INVALID_MANIFEST'), ('size', True, 'INVALID_MANIFEST'), ('sha256', 'bad', 'INVALID_MANIFEST')]:
            with self.subTest(key=key):
                self.capture(); self.edit_manifest(lambda m: m['selection']['job'].update({key: value}))
                self.assertEqual(self.inspect()['code'], code)

    def test_snapshot_flags_cannot_authorize_native_writer(self):
        for field in ('nativeSchemaValidated', 'machineExportAllowed'):
            self.capture(); self.edit_manifest(lambda m: m.update({field: True}))
            report = self.inspect()
            self.assertEqual(report['code'], 'INVALID_MANIFEST')
            self.assertFalse(report['machineExportAllowed'])

    def test_self_consistent_replacement_fails_previous_capture_hash(self):
        old_hash = self.expected
        self.members['Fictional/Board/Board.xml'] = b'<EntirelyDifferent/>'
        self.capture()
        self.assertEqual(self.inspect(expected=old_hash)['code'], 'STALE_PACKAGE')
        self.assertEqual(self.inspect()['status'], 'success')

    def test_unknown_version_duplicate_keys_nonfinite_and_deep_json_fail_closed(self):
        self.edit_manifest(lambda m: m.update(schemaVersion='2'))
        self.assertEqual(self.inspect()['status'], 'unsupported')
        for content in [b'{"schemaVersion":"1","schemaVersion":"1"}', b'{"x":NaN}', b'['*2000+b'0'+b']'*2000, b'not json']:
            self.capture(); self.mutate(lambda files: files.update({'manifest.json': content}))
            self.assertEqual(self.inspect()['status'], 'blocked')

    def test_manifest_cannot_raise_limits_or_use_infinite_values(self):
        self.edit_manifest(lambda m: m['limits']['intake'].update(max_compression_ratio=float('inf')))
        self.assertEqual(self.inspect()['code'], 'INVALID_MANIFEST')
        self.capture(); self.edit_manifest(lambda m: m['limits'].update(max_archive_bytes=999999999999))
        strict = replace(reader.InspectLimits(), capture=replace(reader.CaptureLimits(), max_archive_bytes=2))
        self.assertEqual(self.inspect(limits=strict)['status'], 'blocked')

    def test_outer_missing_extra_duplicate_symlink_and_compression_rejected(self):
        self.mutate(lambda files: files.pop('selected/job.bin'))
        self.assertEqual(self.inspect()['code'], 'INVALID_PACKAGE')
        self.capture(); self.mutate(lambda files: files.update({'../outside': b'bad'}))
        self.assertEqual(self.inspect()['code'], 'ZIP_METADATA_LIMIT')
        self.capture()
        with zipfile.ZipFile(self.snapshot, 'a') as z: z.writestr('extra', b'x')
        self.expected = sha256(self.snapshot.read_bytes()).hexdigest()
        self.assertEqual(self.inspect()['code'], 'ZIP_METADATA_LIMIT')
        self.capture(replace(self.selection, master_member=None, master_role=None))
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.snapshot, 'a') as z: z.writestr('selected/job.bin', b'<duplicate/>')
        self.expected = sha256(self.snapshot.read_bytes()).hexdigest()
        self.assertEqual(self.inspect()['code'], 'INVALID_PACKAGE')
        for mode, compression in [(0o120777, zipfile.ZIP_STORED), (0o100644, zipfile.ZIP_DEFLATED)]:
            self.capture()
            with zipfile.ZipFile(self.snapshot) as z: files = {n:z.read(n) for n in z.namelist()}
            with zipfile.ZipFile(self.snapshot, 'w') as z:
                for name, data in files.items():
                    info=zipfile.ZipInfo(name); info.external_attr=mode<<16; info.compress_type=compression; z.writestr(info,data)
            self.expected=sha256(self.snapshot.read_bytes()).hexdigest()
            self.assertEqual(self.inspect()['code'], 'INVALID_PACKAGE')

    def test_payload_crc_and_truncated_archive_fail_without_data_in_errors(self):
        with zipfile.ZipFile(self.snapshot) as z: info=z.getinfo('selected/job.bin')
        data=bytearray(self.snapshot.read_bytes()); offset=info.header_offset
        payload=offset+30+int.from_bytes(data[offset+26:offset+28],'little')+int.from_bytes(data[offset+28:offset+30],'little')
        data[payload] ^= 1; self.snapshot.write_bytes(data); self.expected=sha256(data).hexdigest()
        result=self.inspect(); self.assertEqual(result['status'],'blocked'); self.assertNotIn('Fictional',json.dumps(result))
        self.snapshot.write_bytes(b'truncated'); self.expected=sha256(b'truncated').hexdigest()
        self.assertEqual(self.inspect()['code'],'INVALID_SNAPSHOT')

    def test_xml_dtd_entities_malformed_and_depth_limits_are_reported(self):
        for xml, code in [(b'<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///never-open">]><x>&ext;</x>', 'XML_REJECTED'), (b'<broken>', 'XML_REJECTED'), (b'<x>'*130+b'</x>'*130, 'XML_LIMIT')]:
            self.members['Fictional/Board/Board.xml']=xml; self.capture()
            report=self.inspect()
            self.assertEqual(report['integrity']['status'],'verified-against-capture-hash')
            self.assertEqual(report['xmlEnvelopes']['job']['code'],code)
            self.assertFalse(report['machineExportAllowed'])
            self.assertNotIn('file:///never-open',json.dumps(report))

    def test_limits_cover_manifest_package_xml_bytes_and_nodes(self):
        for limits in [replace(reader.InspectLimits(), max_package_bytes=2),replace(reader.InspectLimits(), max_manifest_bytes=2)]:
            self.assertEqual(self.inspect(limits=limits)['status'],'blocked')
        for limits in [replace(reader.InspectLimits(), max_xml_bytes=2),replace(reader.InspectLimits(), max_xml_nodes=1)]:
            self.assertEqual(self.inspect(limits=limits)['xmlEnvelopes']['job']['code'],'XML_LIMIT')

    def test_xml_attribute_and_expanded_namespace_names_are_bounded(self):
        for size in (512, 513):
            name = 'a' * (size - 7) + 'version'
            xml = f'<x {name}="invented"/>'.encode()
            report = reader.xml_envelope(io.BytesIO(xml), len(xml), reader.InspectLimits())
            self.assertEqual(report['status'], 'well-formed' if size == 512 else 'blocked')
        xml = ('<x xmlns:v="' + 'u' * 510 + '" v:version="invented"/>').encode()
        report = reader.xml_envelope(io.BytesIO(xml), len(xml), reader.InspectLimits())
        self.assertEqual(report['code'], 'XML_LIMIT')

    def test_mutation_during_copy_or_after_verification_fails_and_cleans_temp(self):
        original_stream=reader._stream
        def change_after_copy(incoming,outgoing,maximum):
            result=original_stream(incoming,outgoing,maximum)
            if outgoing is not None and str(getattr(outgoing,'name','')).endswith('snapshot.bin'):
                self.snapshot.write_bytes(b'replaced source')
            return result
        with patch.object(reader,'_stream',side_effect=change_after_copy):
            self.assertEqual(self.inspect()['code'],'SOURCE_CHANGED')

    def test_cli_uses_one_bounded_request_and_sanitizes_rejection(self):
        request={'protocolVersion':'1','action':'inspect-snapshot','source':str(self.snapshot),'expectedPackageSha256':self.expected}
        proc=subprocess.run([sys.executable,'-m','workers.scan.worker_cli'],input=json.dumps(request).encode(),capture_output=True,timeout=15,cwd=Path(__file__).resolve().parents[3])
        self.assertEqual(proc.returncode,0,proc.stdout); self.assertEqual(proc.stderr,b'')
        report=json.loads(proc.stdout)['result']; self.assertFalse(report['machineExportAllowed'])
        self.assertEqual(report['status'],'success')


if __name__ == '__main__': unittest.main()
