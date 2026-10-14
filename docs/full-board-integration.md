# Full-board integration

Base: `eb50b4b`, current `scan-visual-rebuild` checkout. All 52 prior source files matched the delivered Processing checkpoint before edits. Previous deliveries and build payloads are preserved separately; no machine, shared-library, Drive or remote writes.

## Implementation sequence

1. Derive a complete native scene from freshly parsed snapshot records and existing review/candidate models, independently of bounded event history. Account for invalid coordinates and separate module scopes.
2. Make native-only projects open at full-board scale. Add direct component focus, original/proposed vectors, file-bound status and return-to-board navigation.
3. Connect provenance and supported registration layers; explicitly hold unresolved coordinate mappings. Retain existing tools, writer, project persistence and read-only replay.
4. Build in `.next-full-board`, test synthetic edge cases and the actual private R04 fixture, capture the three requested states and verify earlier deliveries remain unchanged.

## Coordinate contract

Native display uses literal `Roi/cx, Roi/cy` with screen Y increasing downward, no module transform, scale or mirror. Scope is ParentId plus unqualified native side; module TB remains a raw literal. ROI rectangles are displayed for positive dimensions and cardinal angles only until arbitrary native angle semantics are established. These are placement ROI outlines, not manufacturer body geometry.

Normalized CAD uses millimeters, CCW source angles, and screen Y = −source Y. Existing qualified CAD/Gerber registration maps the selected CAD scope into Gerber millimeters before that display Y inversion. Scan imagery remains in pixel coordinates unless a supported mapping exists. No nearest-pad association is introduced.

Native state is derived from complete records, exact review identities/before-values, current diagnosis and reparsed candidate history. Events show processing activity and frozen replay only; telemetry truncation cannot change population or prove completion. Candidate literal confirmation is distinct from byte-level writer preservation tests and Eagle qualification.

Public tests use authored synthetic records. Actual customer archives, projects, evidence and screenshots remain outside the repository.
