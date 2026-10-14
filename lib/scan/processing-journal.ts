import { validComponentProgress, type ProcessingEvent } from "./processing-event";

// In-memory, bounded, short-lived local transport. Never a source of writer authority.
type Journal = { source: string; expires: number; events: ProcessingEvent[]; ended: boolean; dropped: number };
const host = globalThis as typeof globalThis & { scanProcessingJournals?: Map<string, Journal> };
const journals = host.scanProcessingJournals ??= new Map<string, Journal>();
export const validRunId = (s: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
function prune() { for (const [id, value] of journals) if (value.expires < Date.now()) journals.delete(id); }
export function startProcessing(id: string, source: string) {
  prune();
  if (!validRunId(id) || !/^[a-f0-9]{64}$/.test(source) || journals.has(id) || journals.size >= 16) throw new Error("Archive progress request is invalid or expired; retry with a new run.");
  const value: Journal = { source, expires: Date.now() + 300_000, events: [], ended: false, dropped: 0 }; journals.set(id, value);
  return {
    record(input: unknown) { if (value.ended || !validComponentProgress(input)) return; if (value.events.length >= 1024) { value.dropped++; return; } value.events.push({ ...structuredClone(input), sequence: value.events.length + 1, at: new Date().toISOString() }); },
    end() { value.ended = true; value.expires = Date.now() + 60_000; },
  };
}
export function readProcessing(id: string) { prune(); const value = journals.get(id); return value ? structuredClone(value) : null; }

/** stderr is private by default: only a validated, explicitly prefixed event is retained. */
export function processingDecoder(record: (v: unknown) => void) {
  let pending = "", overflow = false;
  return (chunk: string) => {
    for (const piece of chunk.split(/(?<=\n)/)) {
      if (!overflow) pending += piece;
      if (pending.length > 8192) { pending = ""; overflow = true; }
      if (!piece.endsWith("\n")) continue;
      if (!overflow && pending.startsWith("SCAN_COMPONENT_V1 ")) { try { const value = JSON.parse(pending.slice(18)); if (validComponentProgress(value)) record(value); } catch { /* No diagnostics are forwarded. */ } }
      pending = ""; overflow = false;
    }
  };
}
