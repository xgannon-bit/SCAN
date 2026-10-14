"use client";
import { useEffect, useRef, useState } from "react";
import type { ArchiveReview, ArchiveSelection } from "@/lib/scan/archive-types";
import { assetRole, validateImageCatalog, type ImageCatalog } from "@/lib/scan/image-evidence";
import { rasterCache, rasterSourceIdentity } from "@/lib/scan/raster-cache";
import { useScanSession } from "./ScanSession";

export type RasterSelection = { archiveSha256: string; member: string } | null;
/** One on-demand decoded raster per consumer. No gallery-wide decode or saved blobs. */
export function usePreservedRaster(selected: RasterSelection, enabled: boolean, stage = "Scan image") {
  const s = useScanSession(), archive = s.archiveFile, review = s.archiveReview, selection = s.selection;
  const [image, setImage] = useState<{ key: string; url: string; width: number; height: number; sha256: string; member: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { begin, finish } = s.visual;
  const key = JSON.stringify([selected?.archiveSha256, selected?.member, review?.capture.packageSha256, selection]);
  const cacheSource = rasterSourceIdentity(review);
  useEffect(() => { rasterCache.bind(cacheSource); }, [cacheSource]);
  const ready = enabled && !s.busy && !s.archiveBusy && !s.generatedArchive.archiveBusy && !s.returnedArchive.archiveBusy && !s.candidateWorkBusy && !s.nativeAnalysis.busy;
  const ownedUrl = useRef(""), decodedImage = useRef(image); decodedImage.current = image;
  // Loaded pixels live for their asset/view, not for transient save/worker busy flags.
  // This prevents a project save from decoding the same large raster a second time.
  useEffect(() => {
    setImage(null); setError("");
    return () => { if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current); ownedUrl.current = ""; };
  }, [key, enabled]);
  useEffect(() => {
    const abort = new AbortController();
    setBusy(false);
    if (!ready || decodedImage.current?.key === key || !selected || !archive || !review || !selection || review.preflight.source.sha256 !== selected.archiveSha256 || !assetRole(selected.member, review.preflight.selection)) return;
    setError("");
    const run = begin(stage, selected.archiveSha256, "Reading the explicitly selected preserved raster; no registration inferred.");
    setBusy(true);
    void (async () => {
      try {
        const preserved = review.preflight.preservedFiles.filter(f => f.originalName === selected.member);
        if (preserved.length !== 1 || !cacheSource) throw new Error("Exact verified raster source is missing.");
        const cached = await rasterCache.get(cacheSource, selected.member, preserved[0].sha256, preserved[0].size);
        if (abort.signal.aborted) return;
        let blob: Blob, width: number, height: number, sha256: string;
        if (cached) { ({ blob, width, height, sha256 } = cached); }
        else {
          const form = imageForm(archive, review, selection, "image"); form.set("imageMember", selected.member);
          const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal });
          if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) { const data = await response.json(); throw new Error(data.message ?? data.reasons?.join(" ") ?? "Image preview is unavailable."); }
          const bytes = await response.arrayBuffer();
          sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
          if (sha256 !== preserved[0].sha256 || sha256 !== response.headers.get("X-SCAN-SHA256") || bytes.byteLength !== preserved[0].size || response.headers.get("X-SCAN-Source-SHA256") !== selected.archiveSha256 || response.headers.get("X-SCAN-Registration") !== "unregistered") throw new Error("Image provenance differs from the selected snapshot.");
          width = Number(response.headers.get("X-SCAN-Image-Width")); height = Number(response.headers.get("X-SCAN-Image-Height"));
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 80_000_000 || bytes.byteLength > 32_000_000) throw new Error("Image dimensions exceed the preview limit.");
          blob = new Blob([bytes], { type: response.headers.get("content-type")! });
        }
        const decoded = await createImageBitmap(blob);
        if (decoded.width !== width || decoded.height !== height) { decoded.close(); throw new Error("Decoded image dimensions differ from its header."); }
        decoded.close(); if (abort.signal.aborted) return;
        if (!cached) await rasterCache.put(cacheSource, { blob, width, height, sha256, member: selected.member });
        if (abort.signal.aborted) return;
        if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
        ownedUrl.current = URL.createObjectURL(blob); setImage({ key, url: ownedUrl.current, width, height, sha256, member: selected.member });
        finish(run, "completed", `${cached ? "Rehashed cached original" : "Fresh archive raster"} decoded at ${width} × ${height} pixels. No registration inferred.`);
      } catch (error) { if (!abort.signal.aborted) { const message = error instanceof Error ? error.message : "Image decode failed."; setError(message); finish(run, "held", message); } }
      finally { if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => { abort.abort(); finish(run, "cancelled", "Image selection changed or viewer closed."); };
  }, [key, ready, archive, review, selection, begin, finish, stage, attempt, cacheSource]);
  return { image: enabled && image?.key === key ? image : null, busy, error, retry: () => setAttempt(a => a + 1) };
}

export function useVisualImage(enabled = true) {
  const s = useScanSession();
  return usePreservedRaster(s.visual.view.image, enabled && s.visual.view.frame === "image");
}
function imageForm(archive: File, review: ArchiveReview, selection: ArchiveSelection, action: string) {
  const form = new FormData(); form.set("file", archive); form.set("action", action);
  form.set("expectedArchiveSha256", review.preflight.source.sha256); form.set("expectedPackageSha256", review.capture.packageSha256); form.set("selection", JSON.stringify(selection)); return form;
}
export function useImageCatalog(enabled: boolean) {
  const s = useScanSession(), [catalog, setCatalog] = useState<ImageCatalog | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const { begin, finish } = s.visual;
  const archive = s.archiveFile, review = s.archiveReview, selection = s.selection;
  const key = JSON.stringify([review?.capture.packageSha256, selection]);
  const ready = enabled && !s.busy && !s.archiveBusy && !s.generatedArchive.archiveBusy && !s.returnedArchive.archiveBusy && !s.candidateWorkBusy && !s.nativeAnalysis.busy;
  useEffect(() => { setCatalog(null); setError(""); }, [key]);
  useEffect(() => {
    if (!ready || !archive || !review || !selection || (catalog?.sourceSha256 === review.preflight.source.sha256 && catalog?.packageSha256 === review.capture.packageSha256)) return;
    const abort = new AbortController(), run = begin("Image inventory", review.preflight.source.sha256, "Verifying stored image roles and bounded raster headers; no gallery-wide decode.");
    setBusy(true); setError("");
    void (async () => {
      try {
        const response = await fetch("/api/archive", { method: "POST", body: imageForm(archive, review, selection, "image-catalog"), signal: abort.signal });
        const data = await response.json(); if (!response.ok || data.status !== "success") throw new Error(data.message ?? data.reasons?.join(" ") ?? "Image inventory unavailable.");
        const checked = validateImageCatalog(data, review.preflight); if (abort.signal.aborted) return;
        setCatalog(checked); finish(run, "completed", `${checked.entries.length} preserved image assets inventoried; ${checked.omittedAssets} omitted by catalog bounds. Dimensions are headers; previews decode on selection.`);
      } catch (error) { if (!abort.signal.aborted) { const message = error instanceof Error ? error.message : "Image inventory failed."; setError(message); finish(run, "held", message); } }
      finally { if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => { abort.abort(); setBusy(false); finish(run, "cancelled", "Image inventory context changed."); };
  // Do not restart a completed catalog when its journal or selected image changes.
  }, [key, ready, archive, review, selection, begin, finish, attempt]);
  return { catalog: catalog?.sourceSha256 === review?.preflight.source.sha256 && catalog?.packageSha256 === review?.capture.packageSha256 ? catalog : null, busy, error, retry: () => setAttempt(a => a + 1) };
}
