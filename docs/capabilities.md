# CAD, Gerber and job capabilities

These are product targets, not a declaration of implemented format support.

## Integrated offline evaluation route

See [the evaluation guide](evaluation-guide.md). Repair Review now connects selected-source analysis to exact reviewed scalar proposals, explicit qualification acknowledgement, complete native-copy output and a reopenable project in one download. The local X and disable operations are qualification experiments. Their evidence is operator supplied; the writer verifies source/identity/byte preservation, not engineering validity. Binding writes remain held. This does not complete independent whole-board diagnosis or prove a repaired inspection.

| Requested requirement | Current implementation / remaining gap |
| --- | --- |
| Open/resume sources | Native ZIPs and explicit snapshot/Master selection, placement/Gerber mapping and optional hash-verified BOM/evidence attachments persist. BOM parsing/reconciliation missing. |
| Actual-board analysis | Literal native relationships, complete native CAD accounting, duplicate groups, binding observations, coordinate patterns and source alignment are computed. Independent whole-board causal diagnosis remains incomplete. |
| Actionable findings / geometry | Findings and exact native work are available in the main navigation. Native ROI/local-window rectangles and exact source matches are shown in separate frames. Qualified native/source overlays and owned-pad repair geometry missing. |
| Repair Review | Individual accepted/rejected scalar trials, exact before/after and scope, stale checks and dependency closure. Operator supplies intended values/evidence; automatic supported family repair derivation and binding updates missing. |
| Native output | Accepted changes produce complete copied native tree, exact receipts, asset hashes, manifest, accounting/work exports, checklist and reopenable project. Explicitly qualification-only. No complete-inspection-repair claim. |
| Whole-board work | Native CAD/native-only coverage plus actual shared Master/window/algorithm queue. Source-bound component and shared-window notes persist. Review observations do not establish taught/verified status. No automatic approved population or machine verification. |
| Project history | Original bytes, mappings, decisions, exact candidate requests/hash receipts, notes and attachments restore after source verification and recomputation. Earlier candidate bytes stay in their downloaded revisions; sources do not silently retarget old decisions. |
| Laptop delivery | Existing Windows desktop launcher and integrated real screens; separate synthetic demo; first-use guide and portable Eagle checklist. Machine qualification deferred. |

## Repair three different things separately

1. Source-format defects: combined X/Y columns, numeric text, explicit unit conversion, coordinate-format declarations and revision inconsistencies.
2. Cross-file alignment: side, origin, units, angle convention, mirror and module transforms, with independent correspondences and residual checks.
3. Job model defects: duplicate enabled placements, displaced ROIs, dangling relationships, incorrect component-pad associations and inconsistent template reference origins.

Do not move correct CAD to compensate for a misplaced job ROI. Do not rewrite a correct Gerber when the defect is a window's pad association. Native footprint origin, pad-pattern midpoint and optical body center are distinct.

## What can be derived from which input?

| Input | Defensible output | Missing evidence / limits |
| --- | --- | --- |
| Complete supported native PCB layout | Placement export; layout-derived pad/reference layers; native-tool manufacturing exports where actual layers exist | Verify side, revision, population, origin, layer semantics, tool support and independent output comparison |
| Placement file + exact footprint library | Draft placed footprints and AOI reference-pad geometry | A library land pattern is not automatically the approved paste/stencil layer; validate identity, orientation and actual artwork |
| Gerber + assembly drawing + BOM | Cross-check geometry and manually reviewed component association; enriched formats may supply more metadata | Ordinary paste-only Gerber need not contain reference names, MPNs or body origins; no nearest-pad-only assignment |
| Calibrated board scan + dimensional/assembly evidence | Proposed component locations and draft inspection geometry | Account for distortion, occlusion, side, scale and identity; no hidden layers or precise solder limits inferred from a photo |
| Schematic + BOM only | Component/connectivity inventory and missing-source checklist | Not the existing PCB's physical locations, routing, paste, fiducials or panelization |

A schematic may support designing a NEW PCB with explicit layout, routing and engineering decisions. It does not uniquely reconstruct an EXISTING manufactured PCB. That separate ECAD design workflow is outside the first alpha.

## Output classes

- Normalized placement candidate: traceable to supplied source coordinates and confirmed unit/convention rules.
- Derived AOI reference layer: clearly labeled NOT FOR FABRICATION; pad geometry is not automatically paste geometry.
- Manufacturing regeneration: only from authoritative, complete layout/layer data through a supported native exporter and engineering approval.
- Machine job candidate: separate copy with reviewed exact edits, adapter tests and machine compatibility gates.

## Release boundary

BOM/stage exclusions remain provisional until approved. New layouts are not taught optical inspections. No automatic threshold relaxation, guessed OCR identity, polarity approval or product release.

## Primary references

KiCad CLI (version-specific): https://docs.kicad.org/9.0/en/cli/cli.html
Altium footprint center/reference distinction: https://www.altium.com/documentation/knowledge-base/altium-designer/calculate-component-pick-and-place-center-of-a-footprint
Gerber component-information extension: https://www.ucamco.com/en/gerber/gerber-x3
