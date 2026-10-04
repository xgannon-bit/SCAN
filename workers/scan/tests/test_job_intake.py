from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

from workers.scan.job_intake import IntakeLimits, inventory_zip


def write_zip(
    path: Path,
    members: list[tuple[str, bytes]],
    compression=zipfile.ZIP_DEFLATED,
) -> None:
    with zipfile.ZipFile(path, "w", compression=compression) as archive:
        for name, content in members:
            archive.writestr(name, content)


def synthetic_job_members(
    name: str = "SyntheticPanel",
    prefix: str = "SyntheticGroup",
) -> list[tuple[str, bytes]]:
    root = f"{prefix}/{name}"
    return [
        (f"{root}/{name}.xml", b"<synthetic-main />"),
        (f"{root}/{name}_Temp.xml", b"<synthetic-temp />"),
        (f"{root}/{name}.xml.bak", b"<synthetic-backup />"),
        (f"{root}/{name}.jpg", b"synthetic-image"),
        (f"{root}/{name}.his", b"synthetic-history"),
        (f"{prefix}/Master/Master.xml", b"<synthetic-master />"),
    ]


def mark_zip_encrypted(path: Path) -> None:
    data = bytearray(path.read_bytes())
    for signature, flag_offset in (
        (b"PK\x03\x04", 6),
        (b"PK\x01\x02", 8),
    ):
        start = 0
        while True:
            index = data.find(signature, start)
            if index < 0:
                break
            offset = index + flag_offset
            flags = (
                int.from_bytes(data[offset : offset + 2], "little")
                | 0x1
            )
            data[offset : offset + 2] = flags.to_bytes(2, "little")
            start = index + 4
    path.write_bytes(data)


class JobIntakeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_safe_nested_job_inventory_is_deterministic_and_read_only(
        self,
    ) -> None:
        path = self.root / "synthetic.zip"
        write_zip(path, synthetic_job_members())
        before_bytes = path.read_bytes()
        before_hash = sha256(before_bytes).hexdigest()

        first = inventory_zip(path)
        second = inventory_zip(path)

        self.assertEqual(first.status, "success")
        self.assertEqual(first, second)
        self.assertEqual(first.archive_sha256, before_hash)
        self.assertEqual(path.read_bytes(), before_bytes)
        self.assertEqual(len(first.job_roots), 1)

        root = first.job_roots[0]
        self.assertEqual(root.job_name, "SyntheticPanel")
        self.assertEqual(len(root.main_candidates), 1)
        self.assertEqual(len(root.temp_candidates), 1)
        self.assertEqual(len(root.backup_candidates), 1)
        self.assertEqual(len(root.master_candidates), 1)

    def test_path_traversal_blocks(self) -> None:
        path = self.root / "traversal.zip"
        write_zip(path, [("../escape.txt", b"x")])

        result = inventory_zip(path)

        self.assertEqual(result.status, "blocked")
        self.assertIn("path traversal", result.reasons[0])

    def test_surviving_snapshots_discover_root_without_selecting_main(self) -> None:
        for name, role in (("Board_Temp.xml", "temp"), ("Board.xml.bak", "backup"), ("Board.bak", "backup"), ("BOARD.xml", "main")):
            with self.subTest(name=name):
                source = self.root / "recovery.zip"
                write_zip(source, [(f"Group/Board/{name}", b"<fictional />"), ("Group/Master/Master.xml", b"<fictional />")])
                result = inventory_zip(source)
                self.assertEqual(result.status, "success")
                self.assertEqual(len(result.job_roots), 1)
                chosen = result.job_roots[0]
                self.assertEqual(getattr(chosen, f"{role}_candidates"), (f"Group/Board/{name}",))
                if role != "main":
                    self.assertEqual(chosen.main_candidates, ())

    def test_recovery_discovery_does_not_duplicate_roots_or_infer_from_unrelated_backup(self) -> None:
        source = self.root / "recovery.zip"
        write_zip(source, synthetic_job_members() + [("Other/OtherWrong.xml.bak", b"<fictional />")])
        self.assertEqual(len(inventory_zip(source).job_roots), 1)

    def test_absolute_path_blocks(self) -> None:
        path = self.root / "absolute.zip"
        write_zip(path, [("/absolute.txt", b"x")])

        result = inventory_zip(path)

        self.assertEqual(result.status, "blocked")
        self.assertIn("absolute path", result.reasons[0])

    def test_windows_drive_path_blocks(self) -> None:
        path = self.root / "drive.zip"
        write_zip(path, [("C:\\outside.txt", b"x")])

        result = inventory_zip(path)

        self.assertEqual(result.status, "blocked")
        self.assertIn("absolute path", result.reasons[0])

    def test_duplicate_normalized_path_blocks(self) -> None:
        path = self.root / "duplicate.zip"
        write_zip(
            path,
            [("a/./b.txt", b"1"), ("a/b.txt", b"2")],
        )

        result = inventory_zip(path)

        self.assertEqual(result.status, "blocked")
        self.assertIn("duplicate normalized", result.reasons[0])

    def test_case_insensitive_collision_blocks(self) -> None:
        path = self.root / "case.zip"
        write_zip(
            path,
            [("Job/File.xml", b"1"), ("job/file.xml", b"2")],
        )

        result = inventory_zip(path)

        self.assertEqual(result.status, "blocked")
        self.assertIn("case-insensitive", result.reasons[0])

    def test_encrypted_entry_is_unsupported(self) -> None:
        path = self.root / "encrypted.zip"
        write_zip(path, [("secret.txt", b"synthetic")])
        mark_zip_encrypted(path)

        result = inventory_zip(path)

        self.assertEqual(result.status, "unsupported")
        self.assertIn("encrypted", result.reasons[0])

    def test_symlink_entry_is_unsupported(self) -> None:
        path = self.root / "symlink.zip"
        info = zipfile.ZipInfo("synthetic-link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(info, "target")

        result = inventory_zip(path)

        self.assertEqual(result.status, "unsupported")
        self.assertIn("symbolic-link", result.reasons[0])

    def test_malformed_zip_is_unsupported(self) -> None:
        path = self.root / "malformed.zip"
        path.write_bytes(b"not-a-zip")

        result = inventory_zip(path)

        self.assertEqual(result.status, "unsupported")
        self.assertIn("not a supported ZIP", result.reasons[0])

    def test_excess_entry_count_blocks_using_low_limit(self) -> None:
        path = self.root / "entries.zip"
        write_zip(path, [("a.txt", b"a"), ("b.txt", b"b")])

        result = inventory_zip(
            path,
            IntakeLimits(max_entries=1),
        )

        self.assertEqual(result.status, "blocked")
        self.assertIn("entry count", result.reasons[0])

    def test_excess_declared_size_blocks_using_low_limit(self) -> None:
        path = self.root / "size.zip"
        write_zip(
            path,
            [("big.txt", b"12345")],
            compression=zipfile.ZIP_STORED,
        )

        result = inventory_zip(
            path,
            IntakeLimits(max_entry_uncompressed=4),
        )

        self.assertEqual(result.status, "blocked")
        self.assertIn("uncompressed size", result.reasons[0])

    def test_compression_ratio_blocks_using_low_limit(self) -> None:
        path = self.root / "ratio.zip"
        write_zip(path, [("compressible.txt", b"A" * 10_000)])

        result = inventory_zip(
            path,
            IntakeLimits(max_compression_ratio=2.0),
        )

        self.assertEqual(result.status, "blocked")
        self.assertIn("compression-ratio", result.reasons[0])

    def test_small_repetitive_asset_is_bounded_by_absolute_size_not_tiny_compressed_size(self) -> None:
        source = self.root / "small-asset.zip"
        write_zip(source, synthetic_job_members() + [("SyntheticGroup/SyntheticPanel/authored.bin", b"A" * 900_000)])
        self.assertEqual(inventory_zip(source).status, "success")
        constrained = inventory_zip(source, IntakeLimits(max_entry_uncompressed=800_000))
        self.assertEqual(constrained.status, "blocked")
        self.assertIn("uncompressed size", constrained.reasons[0])
        write_zip(source, synthetic_job_members() + [("SyntheticGroup/SyntheticPanel/authored.bin", b"A" * 1_100_000)])
        too_large = inventory_zip(source)
        self.assertEqual(too_large.status, "blocked")
        self.assertIn("compression-ratio", too_large.reasons[0])

    def test_small_member_expansion_boundary_and_aggregate_budget(self) -> None:
        source = self.root / "boundary.zip"
        write_zip(source, synthetic_job_members() + [("synthetic-small.bin", b"A" * 1_024_000)])
        self.assertEqual(inventory_zip(source).status, "success")
        write_zip(source, synthetic_job_members() + [("synthetic-large.bin", b"A" * 1_024_001)])
        self.assertIn("compression-ratio", inventory_zip(source).reasons[0])
        write_zip(source, synthetic_job_members() + [("small-one.bin", b"A" * 500_000), ("small-two.bin", b"A" * 500_000)])
        result = inventory_zip(source, IntakeLimits(max_total_uncompressed=900_000))
        self.assertIn("total uncompressed", result.reasons[0])

    def test_multiple_roots_block_without_selecting_one(self) -> None:
        path = self.root / "multiple.zip"
        write_zip(
            path,
            synthetic_job_members("One", "GroupOne")
            + synthetic_job_members("Two", "GroupTwo"),
        )

        result = inventory_zip(path)

        self.assertEqual(result.status, "blocked")
        self.assertEqual(len(result.job_roots), 2)
        self.assertIn("multiple job roots", result.reasons[0])

    def test_missing_master_blocks_but_preserves_candidates(self) -> None:
        path = self.root / "partial.zip"
        root = "SyntheticGroup/SyntheticPanel"
        write_zip(
            path,
            [(f"{root}/SyntheticPanel.xml", b"<main />")],
        )

        result = inventory_zip(path)

        self.assertEqual(result.status, "blocked")
        self.assertEqual(len(result.job_roots), 1)
        self.assertEqual(
            len(result.job_roots[0].main_candidates),
            1,
        )
        self.assertEqual(
            result.job_roots[0].master_candidates,
            (),
        )
        self.assertTrue(
            any(
                "no related Master" in reason
                for reason in result.reasons
            )
        )

    def test_unsupported_compression_method_blocks(self) -> None:
        path = self.root / "bzip2.zip"
        write_zip(
            path,
            [("a.txt", b"a")],
            compression=zipfile.ZIP_BZIP2,
        )

        result = inventory_zip(path)

        self.assertEqual(result.status, "unsupported")
        self.assertIn("compression method", result.reasons[0])


if __name__ == "__main__":
    unittest.main()
