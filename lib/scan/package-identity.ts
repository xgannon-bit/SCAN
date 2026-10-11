import type { ArchiveReview } from "./archive-types";
import type { BomResult } from "./bom-types";
import type { LayoutResult } from "./layout-types";

/** Exact literal identity reconciliation. Punctuation is never an approved alias. */
export function packageIdentityEvidence(reference: string, module: string, bom: BomResult | null, layout: LayoutResult | null | undefined, archive: ArchiveReview | null) {
  const bomMatches = bom?.references.filter(r => r.normalizedRefdes === reference.trim().toUpperCase() && (!r.scope?.module || r.scope?.module === module)) ?? [];
  const pcbMatches = layout?.placements.filter(r => r.refdes === reference) ?? [];
  const nativeMatches = archive?.preflight.nativeRecords?.job?.records.filter(r => r.kind === "cad-record" && r.rawFields.RefID?.length === 1 && r.rawFields.RefID[0] === reference && r.rawFields.ModuleID?.length === 1 && r.rawFields.ModuleID[0] === module) ?? [];
  const bomRow = bomMatches.length === 1 ? bomMatches[0] : null;
  const component = pcbMatches.length === 1 ? pcbMatches[0].component as { compRef?: string; compValue: string | null } | null : null;
  const native = nativeMatches.length === 1 && nativeMatches[0].rawFields.PrntPartName?.length === 1 ? nativeMatches[0].rawFields.PrntPartName[0] : null;
  const targets = [{ source: "PCB component definition", value: component?.compRef ?? null }, { source: "native CAD part name", value: native }];
  const comparisons = targets.map(t => ({ ...t, state: !bomRow?.mpn || !t.value ? "unresolved" : t.value === bomRow.mpn ? "exact-literal-match" : "different-literal-review-required" }));
  const status = bomRow?.populationEvidence === "engineering-dnp" ? "population-review-needed" : comparisons.every(c => c.state === "exact-literal-match") ? "exact-identity-literals-agree" : "package-qualification-held";
  return { status, bomMpn: bomRow?.mpn ?? null, bomSourceSha256: bom?.sourceSha256 ?? null, bomSourceRow: bomRow?.sourceRow ?? null, pcbSourceSha256: layout?.sourceSha256 ?? null, nativeJobSha256: archive?.preflight.selection?.job.sha256 ?? null, comparisons,
    reason: status === "population-review-needed" ? "Engineering DNP does not establish a fitted package or approve this work order. Review population before enabling."
      : status === "exact-identity-literals-agree" ? "Exact BOM, PCB-definition and native CAD identity literals agree. Manufacturer package/drawing and physical fit still require independent qualification."
      : "Resolve the displayed missing or differing BOM-to-PCB/native identity literals before qualifying this package. Whitespace or punctuation similarity is not an approved alias. Supported disabled geometry can be evaluated independently; this does not authorize a substituted part.",
    packageQualified: false, workOrderApproved: false };
}
