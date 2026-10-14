"use client";
import { useEffect, useState } from "react";
import type { ArchiveReview, ArchiveSelection } from "@/lib/scan/archive-types";
import type { RepairSession } from "@/lib/scan/repair-session";
import { candidateRepairWork } from "@/lib/scan/candidate-repair-work";
import { preservationIdentity, type PreservationProof } from "@/lib/scan/candidate-proof";
import { appendDiagnosisSources } from "@/lib/scan/native-placement-diagnosis";

/** Session-scoped fresh verification; changing inputs hides proof synchronously. Never persisted. */
export function useCandidatePreservation(input: { original: ArchiveReview | null; candidate: ArchiveReview | null; history: RepairSession["history"]; file: File | null; selection: ArchiveSelection | null; layout: File | null; placement: File | null; bom: File | null; ready: boolean; sourceContext: string | null }) {
  const { original, candidate, history, file, selection, layout, placement, bom, ready, sourceContext } = input;
  const revision = [...history].reverse().find(h => h.sourceSha256 === original?.preflight.source.sha256 && h.candidateSha256 === candidate?.preflight.source.sha256);
  const request = revision?.request;
  const identity = original && candidate && request && !revision?.composition && /^[a-f0-9]{64}$/.test(revision?.packageSha256 ?? "") ? preservationIdentity(original.preflight, candidate.preflight, request) : "";
  const key = identity ? JSON.stringify([identity, sourceContext, original?.capture.packageSha256]) : "";
  const [state, setState] = useState<{ key: string; busy: boolean; error: string; proof: PreservationProof | null }>({ key: "", busy: false, error: "", proof: null });
  useEffect(() => {
    const abort = new AbortController();
    if (!ready || !identity || !original || !candidate || !request || !file || !selection) return;
    setState({ key, busy: true, error: "", proof: null });
    void (async () => {
      try {
        const form = new FormData(); form.set("file", file); form.set("action", "repair-review");
        form.set("expectedArchiveSha256", original.preflight.source.sha256); form.set("expectedPackageSha256", original.capture.packageSha256); form.set("selection", JSON.stringify(selection)); form.set("repair", JSON.stringify({ request }));
        appendDiagnosisSources(form, request.diagnosis, { layout, placement, bom });
        const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal }); const result = await response.json();
        if (!response.ok || result.status !== "success" || typeof result.expectedAcceptedJobSha256 !== "string") throw new Error(result.reason ?? result.message ?? "Exact accepted output could not be freshly reproduced.");
        const work = candidateRepairWork(original, candidate, request, result.expectedAcceptedJobSha256, result.diagnosis);
        if (!abort.signal.aborted) setState({ key, busy: false, error: "", proof: { identity, work } });
      } catch (e) { if (!abort.signal.aborted) setState({ key, busy: false, error: e instanceof Error ? e.message : "Preservation verification failed.", proof: null }); }
    })();
    return () => abort.abort();
  }, [ready, key, identity, original, candidate, request, file, selection, layout, placement, bom]);
  const current = ready && !!key && state.key === key;
  return { request, proof: current ? state.proof : null, busy: current && state.busy, error: current ? state.error : "", held: !identity ? "No matching placement-only export history; full preservation is not verified here." : "Fresh preservation verification required." };
}
