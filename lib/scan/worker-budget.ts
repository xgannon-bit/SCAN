type Budget = { active: number; archives: number };
const processState = globalThis as typeof globalThis & { scanWorkerBudget?: Budget };

export function reserveWorker(kind: "placement" | "archive"): () => void {
  const budget = processState.scanWorkerBudget ??= { active: 0, archives: 0 };
  if (budget.active >= 2) throw new Error("Two imports are already running. Wait for one to finish.");
  if (kind === "archive" && budget.archives >= 1) throw new Error("Archive processing is already running. Wait for it to finish.");
  budget.active += 1;
  if (kind === "archive") budget.archives += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true; budget.active -= 1;
    if (kind === "archive") budget.archives -= 1;
  };
}
