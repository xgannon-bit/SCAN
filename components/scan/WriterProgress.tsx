import type { VisualEvent } from "@/lib/scan/visual-workspace";

export function WriterProgress({ events }: { events: VisualEvent[] }) {
  const latest = events.findLast(e => e.stage === "Native writer checks");
  if (!latest) return null;
  const checks = events.filter(e => e.run === latest.run && e.geometry);
  return <section className="scan-review-controls" aria-label="Actual component processing">
    <h3>Native writer · {latest.status === "progress" || latest.status === "started" ? "processing" : latest.status}</h3>
    <p>{latest.message}</p><p>{checks.length} component checks retained in this run. Checks describe staged geometry; delivery and machine qualification remain separate.</p>
    <ul>{checks.slice(-4).map(e => <li key={e.id}>{e.geometry!.identity.ref} · module {e.geometry!.identity.module} · Part {e.geometry!.identity.id} / Master {e.geometry!.identity.master} · {new Date(e.at).toLocaleTimeString()}</li>)}</ul>
  </section>;
}
