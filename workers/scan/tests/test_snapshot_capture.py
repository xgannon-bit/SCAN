from __future__ import annotations

from dataclasses import replace
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from workers.scan import snapshot_capture as capture
from workers.scan.job_intake import IntakeLimits, inventory_zip
from workers.scan.tests.test_job_intake import synthetic_job_members, write_zip


class SnapshotCaptureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "synthetic.zip"
        self.destination = self.root / "review.scan-snapshot"
        self.members = synthetic_job_members() + [
            ("SyntheticGroup/Master/Master_Temp.xml", b"<synthetic-master-temp />"),
            ("SyntheticGroup/Master/Master.xml.bak", b"<synthetic-master-backup />"),
        ]
        write_zip(self.source, self.members, zipfile.ZIP_STORED)
        self.original = self.source.read_bytes()
        self.expected = sha256(self.original).hexdigest()
        self.selection = capture.SnapshotSelection(
            "SyntheticGroup/SyntheticPanel", "SyntheticGroup/SyntheticPanel/SyntheticPanel.xml", "main",
            "SyntheticGroup/Master/Master.xml", "main",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_capture(self, **kwargs):
        return capture.capture_snapshot(self.source, self.destination, self.expected, kwargs.pop("selection", self.selection), **kwargs)

    def assert_no_output(self) -> None:
        self.assertFalse(self.destination.exists())
        self.assertEqual(list(self.root.glob(".scan-capture-*")), [])

    def test_capture_preserves_original_and_selected_bytes_with_verifiable_hashes(self) -> None:
        result = self.run_capture()
        self.assertEqual(result.status, "success", result)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(result.package_sha256, sha256(self.destination.read_bytes()).hexdigest())
        with zipfile.ZipFile(self.destination) as package:
            self.assertEqual(set(package.namelist()), {"manifest.json", "source/archive.zip", "selected/job.bin", "selected/master.bin"})
            self.assertEqual(package.read("source/archive.zip"), self.original)
            self.assertEqual(package.read("selected/job.bin"), b"<synthetic-main />")
            self.assertEqual(package.read("selected/master.bin"), b"<synthetic-master />")
            manifest = json.loads(package.read("manifest.json"))
            self.assertEqual(manifest, result.manifest)
            self.assertEqual(manifest["status"], "complete")
            self.assertEqual(manifest["selection"]["job"]["sha256"], sha256(package.read("selected/job.bin")).hexdigest())
            self.assertFalse(manifest["machineExportAllowed"])
            self.assertFalse(manifest["nativeSchemaValidated"])
            self.assertEqual(len(manifest["members"]), len(self.members))
            self.assertEqual(manifest["holds"], [])

    def test_main_temp_backup_are_explicit_and_remain_distinct(self) -> None:
        ids = set()
        for role, name, expected in [
            ("main", "SyntheticPanel.xml", b"<synthetic-main />"),
            ("temp", "SyntheticPanel_Temp.xml", b"<synthetic-temp />"),
            ("backup", "SyntheticPanel.xml.bak", b"<synthetic-backup />"),
        ]:
            with self.subTest(role=role):
                self.destination = self.root / f"{role}.scan-snapshot"
                selection = replace(self.selection, job_member=f"{self.selection.root}/{name}", job_role=role, master_member="SyntheticGroup/Master/Master_Temp.xml", master_role="temp")
                result = self.run_capture(selection=selection)
                self.assertEqual(result.status, "success")
                ids.add(result.snapshot_id)
                self.assertEqual(result.manifest["selection"]["job"]["role"], role)
                self.assertEqual(result.manifest["selection"]["master"]["role"], "temp")
                with zipfile.ZipFile(self.destination) as package:
                    self.assertEqual(package.read("selected/job.bin"), expected)
                    self.assertEqual(package.read("selected/master.bin"), b"<synthetic-master-temp />")
        self.assertEqual(len(ids), 3)

    def test_same_input_and_selection_produce_deterministic_packages(self) -> None:
        first = self.run_capture()
        first_bytes = self.destination.read_bytes()
        self.destination = self.root / "second.scan-snapshot"
        second = self.run_capture()
        self.assertEqual(first, second)
        self.assertEqual(first_bytes, self.destination.read_bytes())

    def test_existing_destination_is_never_overwritten(self) -> None:
        first = self.run_capture()
        before = self.destination.read_bytes()
        second = self.run_capture()
        self.assertEqual(first.status, "success")
        self.assertEqual(second.code, "DESTINATION_EXISTS")
        self.assertEqual(self.destination.read_bytes(), before)

    def test_destination_appearing_during_publication_is_not_overwritten(self) -> None:
        original_publish = capture._publish_no_overwrite
        def competing_publication(staged, destination):
            destination.write_bytes(b"owned by another capture")
            original_publish(staged, destination)
        with patch.object(capture, "_publish_no_overwrite", side_effect=competing_publication):
            result = self.run_capture()
        self.assertEqual(result.code, "DESTINATION_EXISTS")
        self.assertEqual(self.destination.read_bytes(), b"owned by another capture")
        self.assertEqual(list(self.root.glob(".scan-capture-*")), [])

    def test_wrong_root_member_or_role_never_publishes(self) -> None:
        for selection in [
            replace(self.selection, root="wrong/root"),
            replace(self.selection, job_role="temp"),
            replace(self.selection, job_member="SyntheticGroup/SyntheticPanel/SyntheticPanel.jpg"),
            replace(self.selection, master_role="backup"),
            replace(self.selection, master_member="Other/Master/Master.xml"),
            replace(self.selection, master_member=None),
        ]:
            with self.subTest(selection=selection):
                self.assertEqual(self.run_capture(selection=selection).code, "INVALID_SELECTION")
                self.assert_no_output()

    def test_multiple_roots_require_an_exact_selection_without_newest_heuristics(self) -> None:
        write_zip(self.source, self.members + synthetic_job_members("Second", "OtherGroup"))
        self.expected = sha256(self.source.read_bytes()).hexdigest()
        self.assertEqual(inventory_zip(self.source).status, "blocked")
        result = self.run_capture()
        self.assertEqual(result.status, "success")
        self.assertEqual(result.manifest["selection"]["root"], self.selection.root)
        self.assertEqual(len(result.manifest["jobRoots"]), 2)

    def test_explicit_missing_master_is_preserved_as_analysis_hold(self) -> None:
        write_zip(self.source, [self.members[0]])
        self.expected = sha256(self.source.read_bytes()).hexdigest()
        result = self.run_capture(selection=replace(self.selection, master_member=None, master_role=None))
        self.assertEqual(result.status, "success")
        self.assertIsNone(result.manifest["selection"]["master"])
        self.assertIn("No master snapshot", result.manifest["holds"][0])
        self.assertFalse(result.manifest["machineExportAllowed"])

    def test_stale_source_hash_blocks_before_publication(self) -> None:
        self.source.write_bytes(self.original + b"changed")
        self.assertEqual(self.run_capture().code, "STALE_SOURCE")
        self.assert_no_output()

    def test_source_changed_after_copy_blocks_publication(self) -> None:
        fresh_hash = capture._fresh_hash
        calls = 0
        def change_on_final_read(source, maximum):
            nonlocal calls
            calls += 1
            if calls == 2:
                source.write_bytes(self.original + b"changed during capture")
            return fresh_hash(source, maximum)
        with patch.object(capture, "_fresh_hash", side_effect=change_on_final_read):
            self.assertEqual(self.run_capture().code, "SOURCE_CHANGED")
        self.assert_no_output()

    def test_corrupt_unselected_payload_is_not_mistaken_for_metadata_success(self) -> None:
        with zipfile.ZipFile(self.source) as archive:
            info = archive.getinfo("SyntheticGroup/SyntheticPanel/SyntheticPanel.jpg")
        data = bytearray(self.source.read_bytes())
        offset = info.header_offset
        payload_start = offset + 30 + int.from_bytes(data[offset + 26:offset + 28], "little") + int.from_bytes(data[offset + 28:offset + 30], "little")
        data[payload_start] ^= 1
        self.source.write_bytes(data)
        self.expected = sha256(data).hexdigest()
        self.assertEqual(inventory_zip(self.source).status, "success")
        self.assertEqual(self.run_capture().code, "INVALID_PAYLOAD")
        self.assert_no_output()

    def test_capture_never_extracts_member_names_as_windows_paths(self) -> None:
        write_zip(self.source, self.members + [("SyntheticGroup/SyntheticPanel/CON:stream", b"opaque"), ("SyntheticGroup/SyntheticPanel/name.", b"opaque-dot")])
        self.expected = sha256(self.source.read_bytes()).hexdigest()
        result = self.run_capture()
        self.assertEqual(result.status, "success")
        self.assertIn("SyntheticGroup/SyntheticPanel/CON:stream", [item["originalName"] for item in result.manifest["members"]])
        self.assertEqual({path.name for path in self.root.iterdir()}, {"synthetic.zip", "review.scan-snapshot"})

    def test_unsafe_archive_cannot_bypass_inventory_by_supplying_selection(self) -> None:
        write_zip(self.source, self.members + [("../escape.xml", b"no")])
        self.expected = sha256(self.source.read_bytes()).hexdigest()
        self.assertEqual(self.run_capture().code, "INVENTORY_REJECTED")
        self.assert_no_output()

    def test_malformed_archive_returns_unsupported(self) -> None:
        self.source.write_bytes(b"not a zip")
        self.expected = sha256(self.source.read_bytes()).hexdigest()
        self.assertEqual(self.run_capture().status, "unsupported")
        self.assert_no_output()

    def test_archive_and_decompression_limits_block(self) -> None:
        for limits in [capture.CaptureLimits(max_archive_bytes=4), capture.CaptureLimits(intake=IntakeLimits(max_entry_uncompressed=4)), capture.CaptureLimits(intake=IntakeLimits(max_total_uncompressed=20))]:
            with self.subTest(limits=limits):
                self.assertEqual(self.run_capture(limits=limits).status, "blocked")
                self.assert_no_output()

    def test_interrupted_package_write_leaves_no_completed_or_partial_output(self) -> None:
        with patch.object(capture, "_zip_file", side_effect=OSError("synthetic disk failure with private path")):
            result = self.run_capture()
        self.assertEqual(result.code, "FILESYSTEM_ERROR")
        self.assertNotIn("private path", str(result))
        self.assert_no_output()
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_unsupported_atomic_publication_has_no_copy_fallback(self) -> None:
        with patch.object(capture, "_publish_no_overwrite", side_effect=OSError("no hard links")):
            result = self.run_capture()
        self.assertEqual(result.code, "PUBLICATION_FAILED")
        self.assert_no_output()

    def test_destination_inside_repository_is_rejected(self) -> None:
        self.destination = Path(capture.__file__).resolve().parent / "should-not-exist.scan-snapshot"
        result = self.run_capture()
        self.assertEqual(result.code, "DESTINATION_POLICY")
        self.assert_no_output()

    def test_hash_and_missing_source_fail_closed(self) -> None:
        self.expected = "not-a-hash"
        self.assertEqual(self.run_capture().code, "INVALID_HASH")
        self.expected = sha256(self.original).hexdigest()
        self.source = self.root / "absent.zip"
        self.assertEqual(self.run_capture().code, "FILESYSTEM_ERROR")
        self.assert_no_output()

    def test_stream_enforces_actual_bytes_independently_of_declared_size(self) -> None:
        import io
        with self.assertRaises(capture.CaptureBlocked):
            capture._stream(io.BytesIO(b"actual payload"), None, 3)


if __name__ == "__main__":
    unittest.main()
