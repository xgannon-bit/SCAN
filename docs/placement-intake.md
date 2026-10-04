# A07 placement intake

Open `/intake` on the running loopback app. Select a local `.xlsx` or UTF-8 `.csv`,
read its preview, select a worksheet and confirm the column mapping. For a
headerless input, first data row is 1. Separate X/Y and a combined XY text cell
are supported. Map module/side columns or enter explicit sheet-wide values.

Units and rotation direction begin unconfirmed. Supported units are millimeters,
inches and mils. Rotation direction is clockwise or counterclockwise in degrees.
CSV delimiter, decimal separator and XY separator are explicit settings. No
thousands-separator guessing, origin movement, side mirroring, pad association,
or Gerber alignment occurs. Coordinates remain in the source CAD frame.

The adapter records exact decimal source numbers, source rows, SHA-256, mapping,
module/side/reference identity and unknown MPNs. Formulas are not evaluated or
replaced with cached values. Mapped formulas, Excel errors, merged cells, numeric
identity cells, missing coordinates and duplicate module/side/reference keys
produce row errors. Blank rows are counted separately. Missing MPNs are warnings
and remain null; they do not imply complete component identification.

Only a complete parse with confirmed conventions enables the placement JSON
download. The JSON is a SCAN record, not a CAD interchange or Eagle job. Native
job export remains disabled. Inspection representation, enabled state, teaching,
verification and release all remain unknown. Changes to mapping or source clear
the previous result. Preview and normalization hashes must match. Refresh clears
the shared in-memory review; downloaded files remain on the computer.

## Connected SCAN session

Start from the job dashboard at `/` or Source intake at `/intake`. The same
sidebar and source status appear on every operational screen. The dashboard
shows actual read/parse counts, mapping state, holds and the available next step.
Source findings at `/findings` lists the parser's holds and row issues. Board
workspace at `/workspace` lets you select any parsed source row and inspect its
module, side, reference, MPN, footprint, original decimal coordinates, converted
coordinates and source identity. It currently has no board graphics or overlays.

Client navigation and browser Back/Forward preserve the selected file, mapping,
preview, result and placement selection. Returning to intake may show an empty
browser file chooser, but the selected filename remains visible above it and
Read file still uses that file. No localStorage, sessionStorage or database is
used. Refresh/close clears memory. Save review downloads original source bytes,
mapping, selected row and bounded user notes; Open saved review validates the
saved document and source hash and runs fresh local parsing. Stored derived
results are not accepted. A valid source whose saved settings fail parsing is
restored as an editable draft. Corrupt/unsupported saved files leave the current
source untouched. Review files are confidential runtime documents, not fixtures.

Source, worksheet and delimiter changes invalidate preview, result and selection.
Mapping edits invalidate result and selection. Clearing during an import aborts
the request and rejects late responses. Workspace selection uses source row
within the current result, so even a blocked duplicate-identity record remains
distinct. Partial/blocked results stay labeled and cannot be downloaded as a
complete placement record. Native inspection coverage remains unknown.

The fictional `/demo` walkthrough is separate and opens in another tab from the
dashboard, preserving the active source session without mixing synthetic data.

## Local worker installation

From this checkout on Windows:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r workers/requirements.txt
```

Runtime dependencies are pinned with official PyPI wheel hashes: openpyxl 3.1.5,
et-xmlfile 2.0.0 (MIT), defusedxml 0.7.1 (PSFL). Official metadata lists Python
>=3.8 for openpyxl/et-xmlfile. All three installed and passed tests on Python
3.14.6. PyPI's version JSON listed no vulnerabilities at qualification; this is
not a comprehensive security assurance.

References: [openpyxl](https://pypi.org/project/openpyxl/3.1.5/),
[et-xmlfile](https://pypi.org/project/et-xmlfile/2.0.0/),
[defusedxml](https://pypi.org/project/defusedxml/0.7.1/),
[openpyxl XML protection](https://openpyxl.readthedocs.io/en/stable/_modules/openpyxl/xml/functions.html).

## Execution boundary

The HTTP endpoint accepts only exact same-origin requests to the 127.0.0.1 host.
It streams uploads under a byte cap, assigns a fixed temporary filename outside
the repository, and invokes `.venv` Python directly without shell interpolation.
No path from the browser becomes a local source path. `SCAN_PYTHON` is an optional
trusted process configuration, not a request field. Temporary files are removed
after the worker closes; cancellation terminates the worker. An abnormal process
or OS crash can leave a temporary folder for manual cleanup.

Limits: 8 MB upload, 2 concurrent workers, 30 seconds per worker, 24 MB response,
16 KiB control request, 20 sheets, 10,000 rows, 64 columns, 2,048 characters per
cell. XLSX ZIP limits: 2,000 entries, 32 MB total decompressed, 16 MB per member,
250:1 compression ratio. All XML is checked with DTD/entity/external access
forbidden. Macros, embedded objects and external relationships are unsupported.
Incorrect worksheet dimension metadata cannot silently truncate input rows.
The shared ZIP directory budget also runs before allocating archive entry objects;
ZIP64 end directories and nonordinary prefixed/split archives are unsupported.

The protected parser processes source contents locally. The API has no hosted
inference integration and suppresses library warnings and exceptions containing
source values. The UI escapes source text. Tests and screenshots use only
independently authored fictional data. Local runtime is not permission to commit
private manufacturing files or their derived fixtures.

## Checks

Python tests cover headerless/combined and separate coordinates, explicit units,
clockwise conversion, retained precision, side/module scope, duplicates, missing
data, formulas, merged cells, ZIP/XML limits, producer dimension errors and a
real CLI subprocess. Node tests cover the origin gate, real worker execution,
inert shell-looking text, cancellation and size limits. Browser tests at desktop,
laptop and narrow sizes exercise XLSX/CSV upload, holds, conversion, download,
row failures, refresh/reset, HTTP origin rejection and oversized uploads.
Session tests cover navigation/history, retained mapping and exact row selection,
dashboard downloads, every dependency invalidation, blocked duplicate identities,
and clearing from another screen while a response is held in flight.

Gerber parsing/alignment, native job schema adapters, repair proposals, asset
binding and machine-compatible job construction remain separate unfinished work.
