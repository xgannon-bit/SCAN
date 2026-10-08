"use client";
import Link from "next/link";
import { useScanSession } from "./ScanSession";
import { NativeDuplicateReview } from "./NativeDuplicateReview";

export function OfflineWorkflow() {
  const session = useScanSession();
  const native = session.archiveReview?.preflight;
  return <>
    <section className="scan-panel scan-panel-body" aria-label="Connected offline workflow">
      <h2>Prepare and repair this job copy</h2>
      <p>Review the source frames before deciding what should move. Existing programming, new disabled geometry and optical teaching remain separate work.</p>
      <ol>
        <li><Link href="/intake">Select the complete job and source files</Link>, retaining each revision and the exact main, Temp or backup selection.</li>
        <li><Link href="/workspace#source-registration">Compare source origins and reviewed alignment</Link>. Unit, revision or mirror holds need source evidence; they are not automatic CAD defects.</li>
        <li>Compare duplicate teaching below, prepare supported missing models, then review any local scalar experiment. A survivor preference does not suppress a placement.</li>
        <li>Export accepted preparation and repairs together from Repair Review, or export preparation alone when no scalar change is accepted. Save the project to retain decisions and candidate receipts.</li>
      </ol>
      <p>At Eagle: qualify the candidate, finish pad/FOV links and image-dependent teaching, and verify positions after save/reopen. SCAN has not enabled or validated new inspections.</p>
    </section>
    <NativeDuplicateReview report={native?.nativeDuplicateReview} />
  </>;
}
