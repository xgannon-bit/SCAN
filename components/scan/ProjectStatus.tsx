"use client";
import Link from "next/link";
import { useScanSession } from "./ScanSession";

export function ProjectStatus({ exporting = false }: { exporting?: boolean }) {
  const s = useScanSession(); const request = s.repair.request;
  const decisions = request?.acceptances ?? [];
  const accepted = decisions.filter(item => item.decision === "accepted").length;
  const fresh = request && request.source.archiveSha256 === s.archiveReview?.preflight.source.sha256 && request.source.jobSha256 === s.archiveReview?.preflight.selection.job.sha256;
  const preparation = s.nativePreparation;
  const preparationFresh = preparation.review?.sourceContext === s.sourceContext && preparation.review?.archiveSha256 === s.archiveReview?.preflight.source.sha256;
  const partDecisions = preparationFresh ? preparation.review?.decisions ?? [] : [];
  const preparedRevision = preparation.history.findLast(item => item.review.sourceContext === s.sourceContext && item.review.archiveSha256 === s.archiveReview?.preflight.source.sha256);
  const next = !s.archiveFile && !s.file && !s.bom.file && !s.layout.file ? { href: "/intake", label: "Import a copied job or source files", why: "Start with the files available for this board; pre-arrival review needs no native job." }
    : s.archiveFile && !s.archiveReview ? { href: "/intake#archive-intake", label: "Check the selected native baseline", why: "Choose main, Temp or backup explicitly before interpreting native records." }
    : s.file && !s.result ? { href: "/intake", label: "Finish placement mapping", why: "Coordinates require explicit columns, units, rotation and scope." }
    : s.layout.result && s.archiveReview && s.selection?.jobRole === "main" && s.selection.masterRole === "main" ? { href: "/repair#native-preparation", label: preparedRevision ? "Review remaining native preparation and Athena work" : "Prepare missing native parts", why: preparedRevision ? "The latest candidate receipt records disabled part preparation. Remaining bindings, teaching and unsupported models still need review." : "Use source-owned footprints and compatible job-local models to review complete disabled placement/Master/window proposals." }
    : s.gerber.result?.status === "blocked" || s.gerber.result?.status === "unsupported" ? { href: "/intake#gerber-intake", label: "Review the Gerber interpretation hold", why: "Unqualified source geometry must not drive placement or window corrections." }
    : s.layout.result && !s.archiveReview ? { href: "/findings#draft-preparation", label: "Review source preparation", why: "Keep source-owned family geometry and open questions together before attaching a scanned native job." }
    : request ? { href: "/repair", label: "Review the exact proposal set", why: fresh ? "Accepted changes can produce an isolated qualification candidate; pending and rejected changes are preserved." : "The stored proposal belongs to a different baseline and cannot be exported here." }
    : { href: "/repair", label: "Review native work and supported corrections", why: "Source correspondence alone does not establish an inspection defect or prove teaching complete." };
  return <section className="scan-panel scan-panel-body" aria-label="Project status and next action">
    <h2>{exporting ? "Choose the output you need" : "Board review — next useful action"}</h2>
    <p><Link href={next.href}>{next.label}</Link> — {next.why}</p>
    <p><strong>Baseline:</strong> {s.archiveReview ? `${s.archiveReview.preflight.selection.job.role} snapshot; original bytes preserved` : s.archiveFile ? "Selected; preflight pending" : "Pre-arrival sources only"}.</p>
    <p><strong>Proposals:</strong> {request?.proposals.length ?? 0} total · {accepted} accepted for qualification · {decisions.filter(item => item.decision === "rejected").length} rejected · {decisions.filter(item => item.decision === "pending").length} pending. {request && !fresh && "Stale baseline — export held."}</p>
    <p><strong>Part preparation:</strong> {partDecisions.length} reviewed proposals · {partDecisions.filter(item => item.decision === "accepted").length} accepted disabled preparations. {preparedRevision ? `${preparedRevision.accepted.length} parts recorded as prepared in the latest matching candidate receipt; the original baseline remains unchanged.` : "No matching prepared candidate receipt yet."}</p>
    <p><strong>Candidate history:</strong> {s.repair.history.length + preparation.history.length} generated revision receipts. Baseline analysis does not become candidate analysis after export. Eagle compatibility, pad binding and inspection behavior remain unverified.</p>
    {exporting && <ul><li><strong>Saved project:</strong> resume original source bytes, mappings, BOM, decisions and history using Save project above.</li><li><strong>Review handoff:</strong> findings and remaining work; contains no repaired native job.</li><li><strong>Preserved source package:</strong> unchanged native input and integrity evidence.</li><li><strong>Qualification candidate:</strong> <Link href="/repair">review exact changes and generate the complete separate native copy</Link>. Only accepted, supported scalar trials or new disabled local part/model/window records are applied. Temp/backup snapshots retain their original state; do not substitute them during testing.</li></ul>}
  </section>;
}
