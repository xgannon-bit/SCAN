/** Only hash-verifying inventory/preflight reads may wait for a cancelled worker
 * to release its existing budget. No writer or engineering action is retried. */
export async function fetchArchiveSourceRead(form: FormData, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!["inventory", "preflight"].includes(String(form.get("action")))) throw new Error("Only source reads may wait for the archive worker.");
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetcher("/api/archive", { method: "POST", body: form, signal });
    if (response.status !== 429 || attempt >= 20) return response;
    const value = await response.clone().json().catch(() => null);
    if (value?.code !== "WORKER_BUSY") return response;
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(signal.reason ?? new Error("Source read cancelled.")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 1000);
      signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
    });
  }
}
