from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class WorkerCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def call(self, request, raw=False):
        incoming = request if raw else json.dumps({"protocolVersion": "1", **request}).encode("utf-8")
        process = subprocess.run([sys.executable, "-m", "workers.scan.worker_cli"], input=incoming, capture_output=True,
                                 cwd=Path(__file__).resolve().parents[3], timeout=10)
        self.assertEqual(process.stderr, b"")
        response = json.loads(process.stdout)
        self.assertEqual(response["protocolVersion"], "1")
        return process.returncode, response["result"]

    def test_real_subprocess_example_inventory_capture_and_repeat_rejection(self):
        source = self.root / "synthetic input.zip"
        destination = self.root / "result.scan-snapshot"
        code, example = self.call({"action": "make-example", "destination": str(source)})
        self.assertEqual(code, 0)
        self.assertIn("not an Eagle/Athena job", example["classification"])
        code, inventory = self.call({"action": "inventory", "source": str(source)})
        self.assertEqual(code, 0)
        root = inventory["inventory"]["job_roots"][0]
        request = {"action": "capture", "source": str(source), "destination": str(destination),
                   "expectedArchiveSha256": inventory["inventory"]["archive_sha256"],
                   "selection": {"root": root["root"], "jobMember": root["main_candidates"][0], "jobRole": "main",
                                 "masterMember": "CedarGroup/Master/Master_Temp.xml", "masterRole": "temp"}}
        code, captured = self.call(request)
        self.assertEqual(code, 0, captured)
        self.assertEqual(captured["manifest"]["selection"]["master"]["role"], "temp")
        code, rejected = self.call(request)
        self.assertEqual(code, 2)
        self.assertEqual(rejected["code"], "DESTINATION_EXISTS")

    def test_bad_protocol_json_and_oversized_requests_have_sanitized_failures(self):
        for raw, expected in [(b"{bad", "INVALID_JSON"), (b"\xff", "INVALID_JSON"), (b"x" * 16_385, "REQUEST_TOO_LARGE"),
                              (b'{"protocolVersion":"99","action":"inventory"}', "INVALID_REQUEST")]:
            with self.subTest(expected=expected):
                code, result = self.call(raw, raw=True)
                self.assertEqual(code, 2)
                self.assertEqual(result["code"], expected)

    def test_unknown_fields_relative_paths_and_missing_source_are_rejected(self):
        for request, expected in [
            ({"action": "inventory", "source": "relative.zip"}, "INVALID_REQUEST"),
            ({"action": "inventory", "source": str(self.root / "absent.zip")}, "FILESYSTEM_ERROR"),
            ({"action": "inventory", "source": str(self.root / "absent.zip"), "extra": "private"}, "INVALID_REQUEST"),
        ]:
            with self.subTest(expected=expected):
                code, result = self.call(request)
                self.assertEqual(code, 2)
                self.assertEqual(result["code"], expected)
                self.assertNotIn(str(self.root), json.dumps(result))


if __name__ == "__main__":
    unittest.main()
