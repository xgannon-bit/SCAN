/** Private reviewed evidence; the writer independently validates every field. */
export type PackageProfile = Record<string, unknown> & { id: string; kind: string };
export function validatePackageProfiles(value: unknown): PackageProfile[] {
  if (!Array.isArray(value) || value.length > 20 || JSON.stringify(value).length > 200_000) throw new Error("Package evidence exceeds its bounds.");
  const keys = "attachedPatternName,body,bodyWindowId,compRef,drawing,electrode,graphicsRef,id,kind,nativePartNames,padPinMap,patternRef,seedMasterKey,seedPartId,terminalWindowId";
  const ids = new Set();
  for (const p of value) {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== keys || p.kind !== "symmetric-two-terminal-body-v1" || typeof p.id !== "string" || !p.id || p.id.length > 2048 || ids.has(p.id)) throw new Error("Invalid package evidence identity.");
    ids.add(p.id);
    for (const k of ["patternRef", "graphicsRef", "compRef", "attachedPatternName", "seedPartId", "seedMasterKey", "bodyWindowId", "terminalWindowId"]) if (typeof p[k] !== "string" || !p[k] || p[k].length > 2048 || p[k].includes("\0")) throw new Error("Invalid package evidence literal.");
    const d = p.drawing;
    if (!d || Object.keys(d).sort().join() !== "matchEvidence,page,sha256,url" || typeof d.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(d.sha256) || typeof d.url !== "string" || !d.url.startsWith("https://") || d.url.length > 2048 || !Number.isInteger(d.page) || d.page < 1 || d.page > 100 || typeof d.matchEvidence !== "string" || !d.matchEvidence || d.matchEvidence.length > 4096) throw new Error("Invalid manufacturer drawing evidence.");
    for (const [name, fields] of [["body", "heightMm,offsetAcrossMm,offsetAlongMm,widthMm"], ["electrode", "centerSeparationMm,heightMm,minimumOverlapFraction,widthMm"]]) {
      const g = p[name];
      if (!g || Object.keys(g).sort().join() !== fields || !Object.values(g).every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000) || g.widthMm <= 0 || g.heightMm <= 0) throw new Error("Invalid package drawing dimensions.");
    }
    if (p.electrode.centerSeparationMm <= 0 || p.electrode.minimumOverlapFraction < .5 || p.electrode.minimumOverlapFraction > 1 || !Array.isArray(p.nativePartNames) || !p.nativePartNames.length || p.nativePartNames.length > 20 || p.nativePartNames.some((n: unknown) => typeof n !== "string" || !n || n.length > 2048)) throw new Error("Invalid package drawing match.");
    const map = p.padPinMap;
    if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length !== 2 || new Set(Object.values(map)).size !== 2 || [...Object.keys(map), ...Object.values(map)].some(n => typeof n !== "string" || !/^[1-9][0-9]{0,3}$/.test(n))) throw new Error("Invalid terminal pad/pin map.");
  }
  return value as PackageProfile[];
}
