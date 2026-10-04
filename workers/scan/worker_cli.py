"""One bounded UTF-8 JSON request over stdin; one JSON response over stdout."""
from __future__ import annotations

import json
from pathlib import Path
import sys

from .job_intake import inventory_zip
from .snapshot_capture import CaptureBlocked, CaptureLimits, SnapshotSelection, _fresh_hash, capture_snapshot
from .synthetic_example import write_example

MAX_REQUEST_BYTES = 16_384


def _text(value, maximum=4096) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or "\0" in value:
        raise ValueError("Invalid text field")
    return value


def _path(value) -> Path:
    path = Path(_text(value))
    if not path.is_absolute():
        raise ValueError("An absolute path is required")
    return path


def _error(code: str, reason: str, status="blocked") -> dict:
    return {"status": status, "code": code, "reasons": [reason]}


def dispatch(request) -> dict:
    if not isinstance(request, dict) or request.get("protocolVersion") != "1":
        return _error("INVALID_REQUEST", "Worker protocolVersion must be '1'.")
    action = request.get("action")
    fields = {
        "inventory": {"protocolVersion", "action", "source"},
        "capture": {"protocolVersion", "action", "source", "destination", "expectedArchiveSha256", "selection"},
        "make-example": {"protocolVersion", "action", "destination"},
    }
    if not isinstance(action, str) or action not in fields or set(request) != fields[action]:
        return _error("INVALID_REQUEST", "Unknown action or missing/unrecognized request fields.")
    try:
        if action == "make-example":
            destination = _path(request["destination"])
            repository = Path(__file__).resolve().parents[2]
            if destination.suffix != ".zip" or destination.parent.resolve().is_relative_to(repository):
                return _error("DESTINATION_POLICY", "Synthetic examples must use a new .zip path outside the checkout.")
            write_example(destination)
            return {"status": "success", "code": "SYNTHETIC_EXAMPLE_CREATED", "classification": "Wholly synthetic; not an Eagle/Athena job", "inventory": inventory_zip(destination).to_dict()}
        source = _path(request["source"])
        if action == "inventory":
            # Prevent a huge source from reaching A03's hashing/ZIP metadata reads.
            _fresh_hash(source, CaptureLimits().max_archive_bytes)
            result = inventory_zip(source)
            return {"status": result.status, "code": "INVENTORIED", "inventory": result.to_dict()}
        destination = _path(request["destination"])
        selected = request["selection"]
        if not isinstance(selected, dict) or set(selected) != {"root", "jobMember", "jobRole", "masterMember", "masterRole"}:
            raise ValueError("Selection fields are invalid")
        if selected["jobRole"] not in ("main", "temp", "backup") or selected["masterRole"] not in (None, "main", "temp", "backup"):
            raise ValueError("Invalid role")
        selection = SnapshotSelection(_text(selected["root"], 512), _text(selected["jobMember"], 512), selected["jobRole"],
                                      None if selected["masterMember"] is None else _text(selected["masterMember"], 512), selected["masterRole"])
        return capture_snapshot(source, destination, _text(request["expectedArchiveSha256"], 64), selection).to_dict()
    except (ValueError, TypeError):
        return _error("INVALID_REQUEST", "Request fields are invalid; paths must be absolute and selection must be explicit.")
    except CaptureBlocked as error:
        return _error(error.code, str(error))
    except FileExistsError:
        return _error("DESTINATION_EXISTS", "Destination already exists; no file was overwritten.")
    except OSError:
        return _error("FILESYSTEM_ERROR", "Source or destination could not be accessed. No filesystem details were logged.")


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    try:
        if len(raw) > MAX_REQUEST_BYTES:
            result = _error("REQUEST_TOO_LARGE", "Worker request exceeds its byte limit.")
        else:
            result = dispatch(json.loads(raw.decode("utf-8")))
    except (UnicodeError, json.JSONDecodeError):
        result = _error("INVALID_JSON", "Expected one UTF-8 JSON request.")
    except Exception:
        result = _error("WORKER_ERROR", "Worker could not complete this request. No input contents were logged.")
    envelope = {"protocolVersion": "1", "result": result}
    sys.stdout.buffer.write((json.dumps(envelope, ensure_ascii=True) + "\n").encode("utf-8"))
    return {"success": 0, "blocked": 2, "unsupported": 3}.get(result["status"], 2)


if __name__ == "__main__":
    raise SystemExit(main())
