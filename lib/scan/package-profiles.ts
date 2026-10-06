/** Private reviewed evidence; the writer independently validates every field. */
export type PackageProfile = Record<string, unknown> & { id: string; kind: string };
export function validatePackageProfiles(value: unknown): PackageProfile[] {
  if (!Array.isArray(value) || value.length > 20 || JSON.stringify(value).length > 200_000) throw new Error("Package evidence exceeds its bounds.");
  const keys = "attachedPatternName,body,bodyWindowId,compRef,drawing,electrode,graphicsRef,id,kind,nativePartNames,padPinMap,patternRef,seedMasterKey,seedPartId,terminalWindowId";
  const ids = new Set();
  for (const p of value) {
    if (p?.kind === "polarized-three-terminal-body-v1") {
      validateThreeTerminalProfile(p);
      if (ids.has(p.id)) throw new Error("Duplicate package evidence identity.");
      ids.add(p.id);
      continue;
    }
    if (p?.kind === "polarized-two-terminal-body-v1") {
      validateDiodeProfile(p);
      if (ids.has(p.id)) throw new Error("Duplicate package evidence identity.");
      ids.add(p.id);
      continue;
    }
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

function validateThreeTerminalProfile(p: Record<string, any>) {
  const common = "attachedPatternName,body,bodyWindowId,compRef,drawing,graphicsRef,id,kind,nativePartNames,padPinMap,patternRef,seedMasterKey,seedPartId,terminalWindowId";
  if (Object.keys(p).sort().join() !== [...common.split(","), "anchor", "polarity", "electrodes", "packageRotationDegrees"].sort().join()) throw new Error("Invalid three-terminal evidence fields.");
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000;
  const b = p.body, map = p.padPinMap;
  if (!b || Object.keys(b).sort().join() !== "heightMm,maxHeightMm,maxWidthMm,minHeightMm,minWidthMm,widthMm" || !Object.values(b).every(n => finite(n) && (n as number) > 0) || b.minWidthMm > b.widthMm || b.widthMm > b.maxWidthMm || b.minHeightMm > b.heightMm || b.heightMm > b.maxHeightMm) throw new Error("Invalid manufacturer body bounds.");
  if (!map || Array.isArray(map) || typeof map !== "object" || Object.keys(map).length !== 3 || new Set(Object.values(map)).size !== 3 || [...Object.keys(map), ...Object.values(map)].some(n => typeof n !== "string" || !/^[1-9][0-9]{0,3}$/.test(n))) throw new Error("Three distinct physical pad/pin identities are required.");
  const { anchor, polarity, electrodes, packageRotationDegrees, ...legacy } = p;
  validatePackageProfiles([{ ...legacy, kind: "symmetric-two-terminal-body-v1", body: { widthMm: b.widthMm, heightMm: b.heightMm, offsetAlongMm: 0, offsetAcrossMm: 0 }, electrode: { widthMm: 1, heightMm: 1, centerSeparationMm: 1, minimumOverlapFraction: .5 }, padPinMap: Object.fromEntries(Object.entries(map).slice(0, 2)) }]);
  const evidence = (e: Record<string, any>) => {
    if (!e || Object.keys(e).sort().join() !== "documentId,layoutSha256,locator,method,page,sha256,statement" || !["numbered-footprint", "component-library", "dimensioned-assembly", "manufacturer-package-correspondence"].includes(e.method) || ["documentId", "locator", "statement"].some(k => typeof e[k] !== "string" || !e[k] || e[k].length > 4096 || e[k].includes("\0")) || [e.sha256, e.layoutSha256].some(h => typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h)) || !Number.isInteger(e.page) || e.page < 1 || e.page > 100) throw new Error("Source-bound numbered package evidence is required.");
  };
  if (![0, 90, 180, 270].includes(packageRotationDegrees)) throw new Error("Cardinal numbered drawing rotation required; no mirroring.");
  if (!anchor || Object.keys(anchor).sort().join() !== "evidence,layerNumber,linePaths" || typeof anchor.layerNumber !== "string" || !/^[1-9][0-9]{0,3}$/.test(anchor.layerNumber) || !Array.isArray(anchor.linePaths) || anchor.linePaths.length !== 4 || new Set(anchor.linePaths).size !== 4 || anchor.linePaths.some((s: unknown) => typeof s !== "string" || !s.startsWith("/") || s.length > 4096)) throw new Error("Four owned body-rectangle paths and a layer are required.");
  evidence(anchor.evidence);
  if (!polarity || Object.keys(polarity).sort().join() !== "evidence,pinRoles" || !polarity.pinRoles || Array.isArray(polarity.pinRoles) || Object.keys(polarity.pinRoles).sort().join() !== Object.values(map).sort().join() || Object.values(polarity.pinRoles).sort().join() !== "anode,cathode,no-connection") throw new Error("Physical anode, cathode and no-connection leads must all be retained.");
  evidence(polarity.evidence);
  if (!Array.isArray(electrodes) || electrodes.length !== 3 || electrodes.map(e => e?.pin).sort().join() !== Object.values(map).sort().join() || electrodes.some(e => !e || Object.keys(e).sort().join() !== "centerXmm,centerYmm,heightMm,minimumOverlapFraction,pin,widthMm" || ![e.centerXmm, e.centerYmm, e.widthMm, e.heightMm, e.minimumOverlapFraction].every(finite) || e.widthMm <= 0 || e.heightMm <= 0 || e.minimumOverlapFraction < .5 || e.minimumOverlapFraction > 1)) throw new Error("All three numbered manufacturer physical leads need bounded geometry.");
}

function validateDiodeProfile(p: Record<string, any>) {
  const common = "attachedPatternName,body,bodyWindowId,compRef,drawing,graphicsRef,id,kind,nativePartNames,padPinMap,patternRef,seedMasterKey,seedPartId,terminalWindowId";
  if (Object.keys(p).sort().join() !== [...common.split(","), "anchor", "polarity", "electrodes"].sort().join()) throw new Error("Invalid diode evidence fields.");
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000;
  if (!p.body || Object.keys(p.body).sort().join() !== "heightMm,widthMm" || !Object.values(p.body).every(finite) || p.body.widthMm <= 0 || p.body.heightMm <= 0) throw new Error("Invalid diode body dimensions.");
  const { anchor, polarity, electrodes, ...legacy } = p;
  validatePackageProfiles([{ ...legacy, kind: "symmetric-two-terminal-body-v1", body: { ...p.body, offsetAlongMm: 0, offsetAcrossMm: 0 }, electrode: { widthMm: 1, heightMm: 1, centerSeparationMm: 1, minimumOverlapFraction: .5 } }]);
  const evidence = (e: Record<string, any>) => {
    if (!e || Object.keys(e).sort().join() !== "documentId,layoutSha256,locator,method,page,sha256,statement" || !["numbered-footprint", "component-library", "dimensioned-assembly", "manufacturer-package-correspondence"].includes(e.method) || ["documentId", "locator", "statement"].some(k => typeof e[k] !== "string" || !e[k] || e[k].length > 4096 || e[k].includes("\0")) || [e.sha256, e.layoutSha256].some(h => typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h)) || !Number.isInteger(e.page) || e.page < 1 || e.page > 100) throw new Error("Diode evidence needs a numbered footprint/library or dimensioned correspondence tied to the source layout; appearance and names are insufficient.");
  };
  // Null records are retained as precise evidence holds; they cannot write.
  if (anchor !== null) {
    if (!anchor || Object.keys(anchor).sort().join() !== "evidence,offsetAcrossMm,offsetAlongMm,padNumber" || !Object.hasOwn(p.padPinMap, anchor.padNumber) || !finite(anchor.offsetAlongMm) || !finite(anchor.offsetAcrossMm)) throw new Error("Invalid diode body datum.");
    evidence(anchor.evidence);
  }
  if (polarity !== null) {
    if (!polarity || Object.keys(polarity).sort().join() !== "evidence,pinRoles" || !polarity.pinRoles || Array.isArray(polarity.pinRoles) || Object.keys(polarity.pinRoles).sort().join() !== Object.values(p.padPinMap).sort().join() || Object.values(polarity.pinRoles).sort().join() !== "anode,cathode") throw new Error("Explicit anode/cathode roles must close on the linked source pins.");
    evidence(polarity.evidence);
  }
  if (electrodes !== null) {
    if (!Array.isArray(electrodes) || electrodes.length !== 2 || electrodes.map(e => e?.role).sort().join() !== "anode,cathode" || electrodes.some(e => !e || Object.keys(e).sort().join() !== "centerAcrossMm,centerAlongMm,heightMm,minimumOverlapFraction,role,widthMm" || ![e.centerAcrossMm, e.centerAlongMm, e.widthMm, e.heightMm, e.minimumOverlapFraction].every(finite) || e.widthMm <= 0 || e.heightMm <= 0 || e.minimumOverlapFraction < .5 || e.minimumOverlapFraction > 1)) throw new Error("Invalid separate diode terminal drawing geometry.");
    if (electrodes.find(e => e.role === "cathode").centerAlongMm <= electrodes.find(e => e.role === "anode").centerAlongMm) throw new Error("Drawing axes must run from anode to cathode.");
  }
}
