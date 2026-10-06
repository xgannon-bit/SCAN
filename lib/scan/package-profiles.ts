/** Private reviewed evidence; the writer independently validates every field. */
export type PackageProfile = Record<string, unknown> & { id: string; kind: string };
export function validatePackageProfiles(value: unknown): PackageProfile[] {
  if (!Array.isArray(value) || value.length > 20 || JSON.stringify(value).length > 200_000) throw new Error("Package evidence exceeds its bounds.");
  const keys = "attachedPatternName,body,bodyWindowId,compRef,drawing,electrode,graphicsRef,id,kind,nativePartNames,padPinMap,patternRef,seedMasterKey,seedPartId,terminalWindowId";
  const ids = new Set();
  for (const p of value) {
    if (p?.kind === "numbered-external-terminal-thermal-body-v1") {
      validateThermalTerminalProfile(p);
      if (ids.has(p.id)) throw new Error("Duplicate package evidence identity.");
      ids.add(p.id);
      continue;
    }
    if (p?.kind === "numbered-physical-terminal-body-v1") {
      validatePhysicalTerminalProfile(p);
      if (ids.has(p.id)) throw new Error("Duplicate package evidence identity.");
      ids.add(p.id);
      continue;
    }
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

function validatePhysicalTerminalProfile(p: Record<string, any>) {
  const common = "attachedPatternName,body,bodyWindowId,compRef,drawing,graphicsRef,id,kind,nativePartNames,padPinMap,patternRef,seedMasterKey,seedPartId,terminalWindowId";
  if (Object.keys(p).sort().join() !== [...common.split(","), "anchor", "polarity", "electrodes", "packageRotationDegrees", "absenceEvidence", "pin1"].sort().join()) throw new Error("Invalid numbered physical-lead fields.");
  const map=p.padPinMap, q=p.polarity;
  if (!map || Array.isArray(map) || typeof map!=="object" || Object.keys(map).length<4 || Object.keys(map).length>24 || new Set(Object.values(map)).size!==Object.keys(map).length || [...Object.keys(map),...Object.values(map)].some(n=>typeof n!=="string" || !/^[1-9][0-9]{0,3}$/.test(n))) throw new Error("Bounded distinct numbered footprint pad/component pin identities are required.");
  const allowed=["anode","cathode","ground","output","supply","no-connection","no-physical-lead"];
  if (!q || Object.keys(q).sort().join()!=="evidence,pinRoles" || !q.pinRoles || Array.isArray(q.pinRoles) || Object.keys(q.pinRoles).sort().join()!==Object.values(map).sort().join() || Object.values(q.pinRoles).some(r=>typeof r!=="string" || !allowed.includes(r))) throw new Error("Every mapped pin needs a physical or absent-lead role.");
  const physical=Object.keys(q.pinRoles).filter(n=>q.pinRoles[n]!=="no-physical-lead"), absent=Object.keys(q.pinRoles).filter(n=>q.pinRoles[n]==="no-physical-lead");
  if (physical.length<3 || !absent.length || Object.values(q.pinRoles).filter(r=>r==="anode").length!==1 || Object.values(q.pinRoles).filter(r=>r==="cathode").length!==1) throw new Error("Explicit physical leads, absent leads and one anode/cathode pair are required.");
  if (!Array.isArray(p.electrodes) || p.electrodes.length!==physical.length || p.electrodes.map((e: any)=>e?.pin).sort().join()!==physical.sort().join()) throw new Error("Every physical lead and no absent lead must have manufacturer geometry.");
  if (!p.absenceEvidence || Array.isArray(p.absenceEvidence) || Object.keys(p.absenceEvidence).sort().join()!==absent.sort().join()) throw new Error("Every absent physical lead requires evidence.");
  const evidence=(e: Record<string, any>)=>{
    if (!e || Object.keys(e).sort().join()!=="documentId,layoutSha256,locator,method,page,sha256,statement" || !["numbered-footprint","component-library","dimensioned-assembly","manufacturer-package-correspondence"].includes(e.method) || ["documentId","locator","statement"].some(k=>typeof e[k]!=="string" || !e[k] || e[k].length>4096 || e[k].includes("\0")) || [e.sha256,e.layoutSha256].some(h=>typeof h!=="string" || !/^[a-f0-9]{64}$/.test(h)) || !Number.isInteger(e.page) || e.page<1 || e.page>100) throw new Error("Source-bound manufacturer evidence required.");
  };
  evidence(q.evidence);for(const e of Object.values(p.absenceEvidence))evidence(e as Record<string,any>);
  if (!p.pin1 || Object.keys(p.pin1).sort().join()!=="evidence,pin" || p.pin1.pin!=="1" || !physical.includes(p.pin1.pin)) throw new Error("Physical numbered pin 1 needs orientation evidence.");
  evidence(p.pin1.evidence);
  const subset=physical.sort().slice(0,3),{absenceEvidence,pin1,...shim}=p;
  validateThreeTerminalProfile({...shim,kind:"polarized-three-terminal-body-v1",padPinMap:Object.fromEntries(Object.entries(map).filter(([,n])=>subset.includes(n as string))),polarity:{pinRoles:Object.fromEntries(subset.map((n,i)=>[n,["anode","no-connection","cathode"][i]])),evidence:q.evidence},electrodes:p.electrodes.filter((e: any)=>subset.includes(e.pin))});
  const finite=(n: unknown)=>typeof n==="number" && Number.isFinite(n) && Math.abs(n)<=1000;
  if (p.electrodes.some((e: any)=>!e || Object.keys(e).sort().join()!=="centerXmm,centerYmm,heightMm,minimumOverlapFraction,pin,widthMm" || ![e.centerXmm,e.centerYmm,e.widthMm,e.heightMm,e.minimumOverlapFraction].every(finite) || e.widthMm<=0 || e.heightMm<=0 || e.minimumOverlapFraction<.5 || e.minimumOverlapFraction>1)) throw new Error("Every physical electrode needs bounded geometry.");
}

function validateThermalTerminalProfile(p: Record<string, any>) {
  const common = "attachedPatternName,body,bodyWindowId,compRef,drawing,graphicsRef,id,kind,nativePartNames,padPinMap,patternRef,seedMasterKey,seedPartId,terminalWindowId";
  if (Object.keys(p).sort().join() !== [...common.split(","), "anchor", "polarity", "electrodes", "packageRotationDegrees", "thermalPads", "pin1"].sort().join()) throw new Error("Invalid numbered physical-lead fields.");
  const map=p.padPinMap, q=p.polarity;
  if (!map || Array.isArray(map) || typeof map!=="object" || Object.keys(map).length<4 || Object.keys(map).length>24 || new Set(Object.values(map)).size!==Object.keys(map).length || [...Object.keys(map),...Object.values(map)].some(n=>typeof n!=="string" || !/^[1-9][0-9]{0,3}$/.test(n))) throw new Error("Bounded distinct numbered footprint pad/component pin identities are required.");
  const allowed=["external-terminal","underside-thermal-pad"];
  if (!q || Object.keys(q).sort().join()!=="evidence,pinRoles" || !q.pinRoles || Array.isArray(q.pinRoles) || Object.keys(q.pinRoles).sort().join()!==Object.values(map).sort().join() || Object.values(q.pinRoles).some(r=>typeof r!=="string" || !allowed.includes(r))) throw new Error("Every mapped pin needs a physical or absent-lead role.");
  const physical=Object.keys(q.pinRoles).filter(n=>q.pinRoles[n]==="external-terminal"), absent=Object.keys(q.pinRoles).filter(n=>q.pinRoles[n]==="underside-thermal-pad");
  if (physical.length<3 || !absent.length) throw new Error("Explicit external terminals and underside thermal pads are required.");
  if (!Array.isArray(p.electrodes) || p.electrodes.length!==physical.length || p.electrodes.map((e: any)=>e?.pin).sort().join()!==physical.sort().join()) throw new Error("Every physical lead and no absent lead must have manufacturer geometry.");
  if (!Array.isArray(p.thermalPads) || p.thermalPads.length!==absent.length || p.thermalPads.map((e: any)=>e?.pin).sort().join()!==absent.sort().join()) throw new Error("Every underside pad needs separate geometry and evidence.");
  if (!p.anchor || Object.keys(p.anchor).sort().join()!=="edgeCount,evidence,layerNumber,linePaths" || ![3,4].includes(p.anchor.edgeCount) || !Array.isArray(p.anchor.linePaths) || p.anchor.linePaths.length!==p.anchor.edgeCount || new Set(p.anchor.linePaths).size!==p.anchor.edgeCount) throw new Error("Explicit three/four-edge body frame is required.");
  const evidence=(e: Record<string, any>)=>{
    if (!e || Object.keys(e).sort().join()!=="documentId,layoutSha256,locator,method,page,sha256,statement" || !["numbered-footprint","component-library","dimensioned-assembly","manufacturer-package-correspondence"].includes(e.method) || ["documentId","locator","statement"].some(k=>typeof e[k]!=="string" || !e[k] || e[k].length>4096 || e[k].includes("\0")) || [e.sha256,e.layoutSha256].some(h=>typeof h!=="string" || !/^[a-f0-9]{64}$/.test(h)) || !Number.isInteger(e.page) || e.page<1 || e.page>100) throw new Error("Source-bound manufacturer evidence required.");
  };
  evidence(q.evidence);for(const e of p.thermalPads)evidence(e.evidence);
  if (!p.pin1 || Object.keys(p.pin1).sort().join()!=="evidence,pin" || p.pin1.pin!=="1" || !physical.includes(p.pin1.pin)) throw new Error("Physical numbered pin 1 needs orientation evidence.");
  evidence(p.pin1.evidence);
  const subset=physical.sort().slice(0,3),{thermalPads,pin1,...shim}=p;
  const {edgeCount,...anchor}=p.anchor; if(edgeCount===3)anchor.linePaths=[...anchor.linePaths,"/validation-only-fourth-edge"];
  validateThreeTerminalProfile({...shim,kind:"polarized-three-terminal-body-v1",anchor,padPinMap:Object.fromEntries(Object.entries(map).filter(([,n])=>subset.includes(n as string))),polarity:{pinRoles:Object.fromEntries(subset.map((n,i)=>[n,["anode","no-connection","cathode"][i]])),evidence:q.evidence},electrodes:p.electrodes.filter((e: any)=>subset.includes(e.pin))});
  if(p.thermalPads.some((e: any)=>!e || Object.keys(e).sort().join()!=="centerXmm,centerYmm,evidence,heightMm,minimumOverlapFraction,pin,widthMm")) throw new Error("Unknown underside pad fields.");
  const finite=(n: unknown)=>typeof n==="number" && Number.isFinite(n) && Math.abs(n)<=1000;
  if ([...p.electrodes,...p.thermalPads.map(({evidence,...e}: any)=>e)].some((e: any)=>!e || Object.keys(e).sort().join()!=="centerXmm,centerYmm,heightMm,minimumOverlapFraction,pin,widthMm" || ![e.centerXmm,e.centerYmm,e.widthMm,e.heightMm,e.minimumOverlapFraction].every(finite) || e.widthMm<=0 || e.heightMm<=0 || e.minimumOverlapFraction<.5 || e.minimumOverlapFraction>1)) throw new Error("Every physical electrode needs bounded geometry.");
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
