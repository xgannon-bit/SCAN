"use client";

import { useEffect, useRef, useState } from "react";
import type { ArchiveInventory, ArchiveReview, ArchiveSelection } from "@/lib/scan/archive-types";
import { downloadJson } from "@/lib/scan/review-session";

export function useArchiveSession() {
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [inventory, setInventory] = useState<ArchiveInventory | null>(null);
  const [selection, setSelection] = useState<ArchiveSelection | null>(null);
  const [archiveDraft, setArchiveDraft] = useState({ root: "", job: "", master: "" });
  const [archiveReview, setArchiveReview] = useState<ArchiveReview | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [archiveNotice, setArchiveNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  function invalidate() {
    controller.current?.abort(); controller.current = null;
    setArchiveBusy(false); setArchiveReview(null); setArchiveError(""); setArchiveNotice("");
  }
  function changeArchive(file: File | null) { invalidate(); setArchiveFile(file); setInventory(null); setSelection(null); setArchiveDraft({ root: "", job: "", master: "" }); }
  function changeSelection(value: ArchiveSelection | null, draft: typeof archiveDraft) { invalidate(); setSelection(value); setArchiveDraft(draft); }
  function cancelArchive() { controller.current?.abort(); controller.current = null; setArchiveBusy(false); setArchiveError("Archive operation cancelled."); }
  async function runArchive(action: "inventory" | "preflight" | "download") {
    if (!archiveFile || (action !== "inventory" && (!inventory || !selection)) || (action === "download" && !archiveReview)) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setArchiveBusy(true); setArchiveError(""); setArchiveNotice("");
    if (action !== "download") setArchiveReview(null);
    if (action === "inventory") { setInventory(null); setSelection(null); setArchiveDraft({ root: "", job: "", master: "" }); }
    const form = new FormData();
    form.set("file", archiveFile); form.set("action", action);
    form.set("expectedArchiveSha256", action === "inventory" ? "" : inventory!.archive_sha256);
    form.set("selection", JSON.stringify(action === "inventory" ? null : selection));
    form.set("expectedPackageSha256", action === "download" ? archiveReview!.capture.packageSha256 : "");
    try {
      const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal });
      if (controller.current !== abort || abort.signal.aborted) return;
      if (action === "download" && response.ok && response.headers.get("content-type") === "application/octet-stream") {
        if (response.headers.get("x-scan-sha256") !== archiveReview!.capture.packageSha256 || Number(response.headers.get("content-length")) !== archiveReview!.capture.size) throw new Error("Snapshot response differs from the reviewed capture.");
        // The worker verifies the recreated package hash before streaming it.
        // Keep the browser Blob without allocating additional full-size buffers.
        const blob = await response.blob();
        if (controller.current !== abort || abort.signal.aborted) return;
        if (blob.size !== archiveReview!.capture.size) throw new Error("Snapshot download is incomplete.");
        const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "scan-source.scan-snapshot"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setArchiveNotice("Verified source snapshot sent to browser downloads. This preserves source bytes; it is not an Eagle/Athena candidate.");
      } else {
        const value = await response.json();
        if (controller.current !== abort || abort.signal.aborted) return;
        if (!response.ok || value.message) throw new Error(value.message || "Archive request failed.");
        if (action === "inventory" && value.inventory) setInventory(value.inventory);
        else if (action === "preflight" && value.artifactType === "scan.archive-review" && value.status === "success" && value.preflight.source.sha256 === inventory?.archive_sha256) setArchiveReview(value);
        else throw new Error(value.reasons?.join(" ") || "Archive processing did not return a verified report.");
      }
    } catch (failure) {
      if (controller.current === abort && !abort.signal.aborted) setArchiveError(failure instanceof Error ? failure.message : "Archive import failed.");
    } finally { if (controller.current === abort) { controller.current = null; setArchiveBusy(false); } }
  }
  function downloadArchiveReport() {
    if (!archiveReview) return;
    try { downloadJson(archiveReview, "scan-archive-preflight.json"); setArchiveNotice("Preflight report sent to browser downloads. Use Save source snapshot separately to preserve the captured package."); }
    catch { setArchiveError("Archive report could not be prepared. Try again."); }
  }
  return { archiveFile, inventory, selection, archiveDraft, archiveReview, archiveBusy, archiveError, archiveNotice, changeArchive, changeSelection, cancelArchive, runArchive, downloadArchiveReport };
}
