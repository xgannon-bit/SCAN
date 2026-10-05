export type NativeInspectionWork = {
  artifactType: "scan.native-inspection-work"; schemaVersion: "1"; analyzerVersion: string;
  status: "recorded" | "blocked" | "unavailable"; reason: string; inventoryComplete: boolean;
  sourceContext?: { archiveSha256: string; packageSha256: string; snapshotId: string; selection: unknown };
  interpretation?: string;
  actions: { id: string; owner: string; nextAction: string }[];
  scopes: { id: string; masterKeyLiteral: string; masterMatchState: string; masterPartSourcePaths: string[];
    partIds: string[]; windowIds: string[]; reviewState: string; actionIds: string[] }[];
  parts: { id: string; sourcePath: string; identityLiterals: Record<string, string[]>;
    scopeId: string | null; bindingReview: string; inspectionReview: string }[];
  windows: { id: string; sourcePath: string; scopeId: string | null; rawFields: Record<string, string[]>;
    algorithmIds: string[]; geometryReview: string; bindingReview: string; teachingReview: string; actionIds: string[] }[];
  algorithms: { id: string; sourcePath: string; containerSourcePath: string | null; windowId: string | null;
    rawFields: Record<string, string[]>; teachingReview: string }[];
  counts: { nativeParts: number; masterScopes: number; masterDocumentAvailable: boolean;
    masterWindows: number | null; masterAlgorithms: number | null; unscopedParts: number;
    unscopedWindows: number; unscopedAlgorithms: number; qualifiedInspections: null; completedOfflineInspections: null } | null;
  inspectionRepairEstablished: false; nativeEditsApplied: false; machineExportAllowed: false;
};
