"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardList, FolderOpen, Info, LockKeyhole, ScanLine, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DEMO_FINDINGS, DEMO_LABEL, demoIdentity, type DemoFinding } from "@/lib/scan/demo-fixtures";
import styles from "./SyntheticDemo.module.css";

const steps = [
  { id: "intake", label: "Source Intake", title: "Open Job / Source Intake" },
  { id: "board", label: "Board Workspace", title: "Board Workspace" },
  { id: "evidence", label: "Selected Finding", title: "Selected Finding / Evidence" },
  { id: "repair", label: "Repair Review", title: "Repair Review / Before–After" },
  { id: "debug", label: "Debug Queue", title: "Debug Queue / Export status" },
] as const;
type Stage = typeof steps[number]["id"];
type Decision = "Accepted" | "Rejected";

function Identity({ finding }: { finding: DemoFinding }) {
  return (
    <dl className={styles.identity} aria-label="Exact placement identity">
      <div><dt>Module</dt><dd>{finding.moduleId}</dd></div>
      <div><dt>Side</dt><dd>{finding.side}</dd></div>
      <div><dt>RefDes</dt><dd>{finding.refDes}</dd></div>
      <div><dt>Placement</dt><dd>{finding.placementId}</dd></div>
    </dl>
  );
}

export function SyntheticDemo() {
  const [opened, setOpened] = useState(false);
  const [stage, setStage] = useState<Stage>("intake");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const finding = DEMO_FINDINGS.find(item => item.id === selectedId);
  const current = steps.find(step => step.id === stage)!;
  const queue = DEMO_FINDINGS.filter(item => decisions[item.id]);

  // Browser Back/Forward changes the view without losing in-memory selection.
  // A refresh intentionally starts a new empty presentation session.
  useEffect(() => {
    const syncView = () => {
      const requested = window.location.hash.slice(1);
      const next = steps.find(step => step.id === requested)?.id ?? "intake";
      setStage(opened ? next : "intake");
    };
    syncView();
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, [opened]);

  useEffect(() => { heading.current?.focus(); }, [stage]);

  function navigate(next: Stage) {
    setStage(next);
    window.location.hash = next;
  }

  function openSession() {
    setOpened(true);
    navigate("board");
  }

  function decide(decision: Decision) {
    if (!finding) return;
    setDecisions(previous => ({ ...previous, [finding.id]: decision }));
    navigate("debug");
  }

  return (
    <div className={cn("scan-app", styles.demo)}>
      <aside className="scan-sidebar" aria-label="Synthetic demo navigation">
        <div className="scan-brand">
          <span className="scan-brand-mark"><ScanLine aria-hidden="true" /></span>
          <div><strong>SCAN</strong><span>Fictional engineering walkthrough</span></div>
        </div>
        <Separator />
        <nav className="scan-nav" aria-label="Demo stages">
          {steps.map((step, index) => (
            <Button key={step.id} variant="ghost"
              className={cn("scan-nav-item", stage === step.id && "active")}
              aria-label={step.label} aria-current={stage === step.id ? "step" : undefined}
              disabled={!opened && step.id !== "intake"}
              onClick={() => navigate(step.id)}>
              <span>{String(index + 1).padStart(2, "0")} · {step.label}</span>
            </Button>
          ))}
        </nav>
        <a href="/" className={buttonVariants({ variant: "outline" })}><ArrowLeft aria-hidden="true" />Back to foundation</a>
        <div className="scan-sidebar-foot">
          <ClipboardList aria-hidden="true" className="text-primary" />
          <div><strong>Presentation only</strong><span>No source files or machine writes</span></div>
        </div>
      </aside>

      <main className="scan-main">
        <header className="scan-header">
          <div><p className="scan-eyebrow">A01-DEMO-01</p><h1>{opened ? "Cedar-7 · fictional panel" : "Explore a fictional session"}</h1></div>
          <div className="scan-header-actions">
            <Badge variant="outline">{opened ? "DEMO-SESSION-001" : "No session opened"}</Badge>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Demo limitations" />}><Info aria-hidden="true" /></TooltipTrigger>
              <TooltipContent>Fictional presentation only. No source is parsed or changed. No decision validates or releases a job.</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <div className={cn("scan-safety-banner", styles.banner)} role="status">
          <strong>{DEMO_LABEL}</strong>
          <span>Decisions reset on refresh. Simulated acceptance never means validation or release.</span>
        </div>

        <div className={styles.stageHeading}>
          <div><p className="scan-eyebrow">Step {steps.indexOf(current) + 1} of 5</p><h2 ref={heading} tabIndex={-1}>{current.title}</h2></div>
          <Badge variant="secondary">{opened ? "Fictional revision FICTION-R1" : "Presentation preview"}</Badge>
        </div>

        {stage === "intake" && (
          <section className={cn("scan-panel", styles.intake)} aria-label="Fictional source intake">
            <div className={styles.intakeCopy}>
              <FolderOpen size={30} aria-hidden="true" className="text-primary" />
              <h3>A small, inspectable walkthrough</h3>
              <p>Open Cedar-7, select an exact placement, inspect its authored evidence card, then simulate a review decision and see the matching debug item.</p>
              <p>The sample has three placements. Two are named R7, on different modules. Their identities and review decisions stay separate.</p>
              <Button onClick={opened ? () => navigate("board") : openSession}>
                {opened ? "Resume fictional session" : "Open fictional session"}<ArrowRight aria-hidden="true" />
              </Button>
            </div>
            <div className={styles.sourceCard}>
              <Badge variant="outline">Wholly synthetic</Badge>
              <h3>DEMO-SESSION-001</h3>
              <dl className={styles.facts}>
                <div><dt>Source</dt><dd>Authored presentation fixtures</dd></div>
                <div><dt>Revision</dt><dd>FICTION-R1</dd></div>
                <div><dt>Snapshot / hash</dt><dd>None captured</dd></div>
                <div><dt>Real job inputs</dt><dd>None</dd></div>
              </dl>
              <Separator />
              <p>Live intake and analysis are unavailable.</p>
              <div className={styles.actions}><Button variant="outline" disabled>Open Job (live)</Button><Button variant="outline" disabled>Analyze</Button></div>
            </div>
          </section>
        )}

        {stage === "board" && (
          <section className={styles.boardLayout} aria-label="Fictional board workspace">
            <article className="scan-panel">
              <div className="scan-panel-heading"><h3>Select a finding</h3><Badge variant="secondary">3 fictional examples</Badge></div>
              <div className={styles.findingList}>
                {DEMO_FINDINGS.map(item => (
                  <Button key={item.id} variant="ghost" className={styles.finding}
                    aria-label={`Select ${demoIdentity(item)}`} aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}>
                    <span className={styles.findingTop}><strong>{item.refDes} · {item.moduleId}</strong><Badge variant="outline">{item.side}</Badge></span>
                    <span>{item.title}</span><code>{item.placementId}</code>
                    <span className={styles.muted}>{item.id}{decisions[item.id] ? ` · Simulated ${decisions[item.id].toLowerCase()}` : " · Unreviewed"}</span>
                  </Button>
                ))}
              </div>
            </article>
            <article className="scan-panel">
              <div className="scan-panel-heading"><h3>Static fictional board illustration</h3><Badge variant="outline">Not to scale</Badge></div>
              <div className={styles.boardDrawing} aria-label="Illustrated placement selection">
                {DEMO_FINDINGS.map(item => (
                  <div key={item.id} className={cn(styles.boardTile, selectedId === item.id && styles.selectedTile)} data-testid={`illustration-${item.id}`}>
                    <span>{item.moduleId} · {item.side}</span>
                    <svg viewBox="0 0 180 100" role="img" aria-label={`Fictional ${item.refDes} on ${item.moduleId} ${item.side}`}>
                      <path d="M12 28H48V50H65 M115 50H142V74H168" fill="none" stroke="currentColor" strokeWidth="2" opacity=".4" />
                      <rect x="52" y="36" width="18" height="28" rx="3" fill="currentColor" opacity=".45" />
                      <rect x="110" y="36" width="18" height="28" rx="3" fill="currentColor" opacity=".45" />
                      <rect x="68" y="30" width="44" height="40" rx="4" fill="var(--scan-panel)" stroke="currentColor" strokeWidth="2" />
                      <text x="90" y="55" textAnchor="middle" fill="currentColor" fontSize="14">{item.refDes}</text>
                    </svg>
                    <code>{item.placementId}</code>
                    <strong>{selectedId === item.id ? "Selected placement" : "Not selected"}</strong>
                  </div>
                ))}
              </div>
              <p className={styles.boardCaption}>Illustration only. No measured coordinates, fitted transforms, pad ownership or teaching evidence.</p>
              <Separator />
              <div className={styles.selection} aria-live="polite">
                {finding ? <><Identity finding={finding} /><Button onClick={() => navigate("evidence")}>View selected evidence<ArrowRight aria-hidden="true" /></Button></> : <p>Select one exact placement from the findings list.</p>}
              </div>
            </article>
          </section>
        )}

        {(stage === "evidence" || stage === "repair") && (
          <section className={cn("scan-panel", styles.detail)} aria-label={stage === "evidence" ? "Selected evidence" : "Simulated repair review"}>
            {!finding ? <><h3>Select a placement first</h3><p>Evidence and review must refer to one exact module, side and placement.</p><Button onClick={() => navigate("board")}>Choose a finding</Button></> : <>
              <div className={styles.detailTitle}><h3>{finding.title}</h3><Badge variant="outline">{finding.id}</Badge></div>
              <Identity finding={finding} />
              <Separator />
              {stage === "evidence" ? <>
                <div className={styles.evidenceGrid}>
                  <div><h4>Authored evidence</h4><p>{finding.evidence}</p><p className={styles.muted}>Source: fictional fixture {finding.id} · revision FICTION-R1. No file was analyzed.</p></div>
                  <div><h4>Evidence limits</h4><p>Coordinate frame and units: unknown. No source hash, machine image, taught inspection or independent verification.</p><Badge variant="destructive">Native writing blocked</Badge></div>
                </div>
                <Button onClick={() => navigate("repair")}>Review fictional proposal<ArrowRight aria-hidden="true" /></Button>
              </> : <>
                <p>Compare an authored source note with a proposed review annotation. This simulation never modifies a placement or source file.</p>
                <div className={styles.evidenceGrid}>
                  <div className={styles.comparison}><h4>Before · fictional source</h4><p>{finding.before}</p><Badge variant="secondary">Source stays unchanged</Badge></div>
                  <div className={styles.comparison}><h4>After · proposal only</h4><p>{finding.proposed}</p><Badge variant="outline">Not a saved candidate</Badge></div>
                </div>
                <p>Both decisions create a demo debug item. Acceptance does not validate geometry, teach inspection or grant release.</p>
                <p className={styles.muted}>Current decision: {decisions[finding.id] ? `simulated ${decisions[finding.id].toLowerCase()}` : "unreviewed"}.</p>
                <div className={styles.actions}>
                  <Button onClick={() => decide("Accepted")}><Check aria-hidden="true" />Simulate Accept</Button>
                  <Button variant="outline" onClick={() => decide("Rejected")}><X aria-hidden="true" />Simulate Reject</Button>
                </div>
              </>}
            </>}
          </section>
        )}

        {stage === "debug" && (
          <section className={cn("scan-panel", styles.detail)} aria-label="Demo debug queue">
            <div className={styles.detailTitle}><h3>Simulated review decisions</h3><Badge variant="secondary">{queue.length} demo items</Badge></div>
            {queue.length === 0 ? <p>No simulated decisions yet. Choose a finding and review its fictional proposal.</p> : <div className={styles.queue}>
              {queue.map(item => <article key={item.id} className={styles.queueItem} aria-label={`Debug item ${item.debugId}`}>
                <div className={styles.detailTitle}><h4>{item.debugId} · {item.refDes}</h4><Badge variant={decisions[item.id] === "Accepted" ? "outline" : "secondary"}>Simulated {decisions[item.id].toLowerCase()}</Badge></div>
                <Identity finding={item} />
                <p>{item.title} · {item.id}</p>
                <p className={styles.muted}>Review annotation only. Source unchanged. No validated or released candidate.</p>
                <Button variant="outline" size="sm" onClick={() => { setSelectedId(item.id); navigate("repair"); }}>Revisit {item.debugId}</Button>
              </article>)}
            </div>}
            <Separator />
            <div className={styles.exportStatus}>
              <LockKeyhole aria-hidden="true" className="text-primary" />
              <div><h4>Machine-job export unavailable</h4><p id="demo-export-reason">No captured source, qualified writer, compatibility evidence or approved repair exists. No export file is produced by this demo.</p></div>
              <Button variant="outline" disabled aria-describedby="demo-export-reason">Export machine job</Button>
            </div>
            <Button onClick={() => navigate("board")}>Review another fictional finding<ArrowRight aria-hidden="true" /></Button>
          </section>
        )}

        <section className="scan-coverage" aria-label="Demo coverage states">
          {["Represented", "Enabled", "Taught", "Verified", "Released"].map((label, index) => (
            <div className="scan-metric" key={label}><span>{label}</span><strong aria-label={`${label}: ${opened && index === 0 ? "3 fictional placements" : "unknown"}`}>{opened && index === 0 ? "3" : "—"}</strong></div>
          ))}
        </section>
        <p className={styles.footer}>Coverage is fictional. Represented counts illustrated placements only; — means unknown, not zero. Decisions never change inspection, verification or release states. This walkthrough does not complete A14–A21.</p>
      </main>
    </div>
  );
}
