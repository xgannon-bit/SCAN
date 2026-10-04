"use client";

import { useEffect, useRef, useState } from "react";
import type { ArchiveInventory, ArchiveReview, ArchiveSelection } from "@/lib/scan/archive-types";
import { downloadJson } from "@/lib/scan/review-session";
import { reviewMatchesSelection, selectionInInventory, type RestoredArchive } from "@/lib/scan/project-session";

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
  const archiveRevision = useRef(0);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  function invalidate() {
    archiveRevision.current += 1;
    controller.current?.abort(); controller.current = null;
    setArchiveBusy(false); setArchiveReview(null); setArchiveError(""); setArchiveNotice("");
  }
  function changeArchive(file: File | null) { invalidate(); setArchiveFile(file); setInventory(null); setSelection(null); setArchiveDraft({ root: "", job: "", master: "" }); }
  function changeSelection(value: ArchiveSelection | null, draft: typeof archiveDraft) { invalidate(); setSelection(value); setArchiveDraft(draft); }
  function cancelArchive() { archiveRevision.current += 1; controller.current?.abort(); controller.current = null; setArchiveBusy(false); setArchiveError("Archive operation cancelled."); }
  async function runArchive(action: "inventory" | "preflight" | "download" | "reference") {
    const downloading = action === "download" || action === "reference";
    if (!archiveFile || (action !== "inventory" && (!inventory || !selection)) || (downloading && !archiveReview)) return;
    archiveRevision.current += 1;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setArchiveBusy(true); setArchiveError(""); setArchiveNotice("");
    if (!downloading) setArchiveReview(null);
    if (action === "inventory") { setInventory(null); setSelection(null); setArchiveDraft({ root: "", job: "", master: "" }); }
    const form = new FormData();
    form.set("file", archiveFile); form.set("action", action);
    form.set("expectedArchiveSha256", action === "inventory" ? "" : inventory!.archive_sha256);
    form.set("selection", JSON.stringify(action === "inventory" ? null : selection));
    form.set("expectedPackageSha256", downloading ? archiveReview!.capture.packageSha256 : "");
    try {
      const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal });
      if (controller.current !== abort || abort.signal.aborted) return;
      if (downloading && response.ok && response.headers.get("content-type") === "application/octet-stream") {
        if (action === "download" && (response.headers.get("x-scan-sha256") !== archiveReview!.capture.packageSha256 || Number(response.headers.get("content-length")) !== archiveReview!.capture.size)) throw new Error("Snapshot response differs from the reviewed capture.");
        if (action === "reference" && (response.headers.get("x-scan-source-sha256") !== archiveReview!.preflight.source.sha256 || response.headers.get("x-scan-native-edits") !== "none" || !/^[a-f0-9]{64}$/.test(response.headers.get("x-scan-sha256") ?? ""))) throw new Error("Reference response differs from the reviewed source.");
        // The worker verifies the recreated package hash before streaming it.
        // Keep the browser Blob without allocating additional full-size buffers.
        const blob = await response.blob();
        if (controller.current !== abort || abort.signal.aborted) return;
        if (blob.size !== Number(response.headers.get("content-length"))) throw new Error("Snapshot download is incomplete.");
        const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = action === "reference" ? "scan-preserved-native-reference.zip" : "scan-source.scan-snapshot"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setArchiveNotice(action === "reference" ? "Preserved native source package downloaded with fresh integrity evidence. No native edits were applied; this is not a newly programmed job." : "Verified source snapshot sent to browser downloads. This preserves source bytes; it is not an Eagle/Athena candidate.");
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
  function loadArchiveDraft(saved: RestoredArchive) {
    invalidate(); setArchiveFile(saved.file); setInventory(null);
    setSelection(saved.record.selection); setArchiveDraft(saved.record.draft);
  }
  async function restoreArchive(saved: RestoredArchive, signal: AbortSignal): Promise<boolean> {
    loadArchiveDraft(saved);
    const current = archiveRevision.current;
    const abort = new AbortController(); controller.current = abort;
    const cancelRestore = () => abort.abort(); signal.addEventListener("abort", cancelRestore, { once: true });
    if (signal.aborted) abort.abort();
    const active = () => controller.current === abort && current === archiveRevision.current && !abort.signal.aborted;
    const { record, file } = saved;
    setArchiveBusy(true);
    async function request(action: "inventory" | "preflight") {
      const form = new FormData(); form.set("file", file); form.set("action", action);
      form.set("expectedArchiveSha256", action === "inventory" ? "" : record.source.sha256);
      form.set("selection", JSON.stringify(action === "inventory" ? null : record.selection));
      form.set("expectedPackageSha256", "");
      const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal });
      const value = await response.json();
      if (!response.ok || value.message) throw new Error(value.message || "Saved archive could not be read again locally.");
      return value;
    }
    try {
      const value = await request("inventory");
      if (!active()) return false;
      const fresh: ArchiveInventory | undefined = value.inventory;
      if (!fresh || fresh.archive_sha256 !== record.source.sha256 || fresh.archive_size !== record.source.size) throw new Error("Restored archive inventory does not match the saved source hash and size.");
      setInventory(fresh);
      if (record.selection) {
        if (!selectionInInventory(record.selection, fresh)) { setSelection(null); throw new Error("Saved snapshot selection is absent from the fresh inventory. Choose an exact job and master snapshot again."); }
        setSelection(record.selection);
        const reviewed: ArchiveReview = await request("preflight");
        if (!active()) return false;
        if (!reviewMatchesSelection(reviewed, record.selection, record.source)) throw new Error("Fresh preflight differs from the saved source or explicit snapshot selection.");
        setArchiveReview(reviewed);
      }
      setArchiveNotice(record.selection ? "Archive restored; inventory and selected snapshot preflight were recomputed locally." : "Archive restored and inventoried again. Complete the explicit snapshot selection before preflight.");
      return true;
    } catch (failure) {
      if (active()) setArchiveError(failure instanceof Error ? failure.message : "Saved archive could not be read again locally.");
      return false;
    } finally {
      signal.removeEventListener("abort", cancelRestore);
      if (controller.current === abort) { controller.current = null; setArchiveBusy(false); }
    }
  }
  function downloadArchiveReport() {
    if (!archiveReview) return;
    try { downloadJson(archiveReview, "scan-archive-preflight.json"); setArchiveNotice("Preflight report sent to browser downloads. Use Save source snapshot separately to preserve the captured package."); }
    catch { setArchiveError("Archive report could not be prepared. Try again."); }
  }
  return { archiveFile, inventory, selection, archiveDraft, archiveReview, archiveBusy, archiveError, archiveNotice, changeArchive, changeSelection, cancelArchive, runArchive, downloadArchiveReport, loadArchiveDraft, restoreArchive, archiveRevision };
}
