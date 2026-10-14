export function authoredDiagnosis(options?: { aligned?: boolean; duplicate?: boolean }): {
  job: string; master: string; pcb: string; placement: string; bom: string; context: any; expected: number[];
  members: Record<string, string>; archive: Buffer; selection: { root: string; jobMember: string; jobRole: 'main'; masterMember: string; masterRole: 'main' };
};
export function requestFromDiagnosis(report: any, context: any): any;
