"use client";
import { useEffect, useRef, useState } from "react";
import type { ArchiveReview, ArchiveSelection } from "@/lib/scan/archive-types";
import { appendDiagnosisSources, type NativeDiagnosisContext, type NativeDiagnosisReport } from "@/lib/scan/native-placement-diagnosis";
import type { useVisualSession } from "./VisualSession";

export function useNativeAnalysis(input: { basis: string; contextHash: string | null; context: NativeDiagnosisContext | null; ready: boolean; original: ArchiveReview | null; selection: ArchiveSelection | null; file: File | null; layout: File | null; placement: File | null; bom: File | null; visual: ReturnType<typeof useVisualSession>; publish: (value: { basis: string; context: NativeDiagnosisContext; report: NativeDiagnosisReport }) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null), currentBasis = useRef(input.basis); currentBasis.current = input.basis;
  useEffect(() => { controller.current?.abort(); controller.current = null; setBusy(false); setMessage(""); return () => controller.current?.abort(); }, [input.basis]);
  function cancel() { controller.current?.abort(); controller.current = null; setBusy(false); setMessage("Analysis cancelled; pending findings were not applied."); }
  async function run() {
    const { original, selection, context, basis, file, layout, placement, bom } = input;
    if (!input.ready || !original || !selection || !context || !file || busy) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setMessage("");
    const form = new FormData(); form.set("file", file); form.set("action", "placement-diagnosis"); form.set("selection", JSON.stringify(selection)); form.set("expectedArchiveSha256", original.preflight.source.sha256); form.set("expectedPackageSha256", original.capture.packageSha256); form.set("diagnosis", JSON.stringify(context));
    try {
      appendDiagnosisSources(form, context, { layout, placement, bom });
      const response = await input.visual.fetchArchive(form, abort.signal, input.contextHash ?? ""); const report = await response.json();
      if (!response.ok || report.artifactType !== "scan.native-placement-diagnosis" || report.status !== "success") throw new Error(report.reason ?? report.message ?? "Independent diagnosis is held.");
      if (!abort.signal.aborted && currentBasis.current === basis) { input.publish({ basis, context: { ...context, diagnosisSha256: report.diagnosisSha256 }, report }); setMessage("Original sources re-read; independent findings frozen. No native fields changed. Select a supported row to send its exact proposal to review."); }
    } catch (e) { if (!abort.signal.aborted && currentBasis.current === basis) setMessage(e instanceof Error ? e.message : "Diagnosis failed."); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  return { busy, message, ready: input.ready && !busy, run, cancel };
}
