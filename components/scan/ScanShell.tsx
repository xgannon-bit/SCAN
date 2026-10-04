"use client";

import { FolderOpen, Info, Layers, LockKeyhole, ScanLine, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  "Jobs",
  "Board Workspace",
  "Findings",
  "Repair Review",
  "Debug Queue",
  "Library Evidence",
  "History",
  "Settings",
] as const;

const workflow = [
  ["01", "Open Job", "current"],
  ["02", "Analyze", "blocked"],
  ["03", "Review Findings", "blocked"],
  ["04", "Review Changes", "blocked"],
  ["05", "Export", "blocked"],
] as const;

const coverage = [
  ["Represented", "—"],
  ["Enabled", "—"],
  ["Taught", "—"],
  ["Verified", "—"],
  ["Released", "—"],
] as const;

export function ScanShell() {
  return (
    <div className="scan-app">
      <aside className="scan-sidebar" aria-label="Primary navigation">
        <div className="scan-brand">
          <span className="scan-brand-mark" aria-hidden="true">
            <ScanLine aria-hidden="true" />
          </span>
          <div>
            <strong>SCAN</strong>
            <span>Smart Component Analysis Navigator</span>
          </div>
        </div>

        <Separator />

        <nav className="scan-nav">
          {navItems.map((item, index) => (
            <Button
              variant="ghost"
              className={
                index === 0 ? "scan-nav-item active" : "scan-nav-item"
              }
              type="button"
              key={item}
              disabled={index !== 0}
              aria-current={index === 0 ? "page" : undefined}
            >
              <span>{item}</span>
              {index !== 0 ? (
                <span className="scan-nav-lock">Soon</span>
              ) : null}
            </Button>
          ))}
        </nav>

        <div className="scan-sidebar-foot">
          <span className="scan-status-dot" aria-hidden="true" />
          <div>
            <strong>Local engineering alpha</strong>
            <span>Read-only foundation</span>
          </div>
        </div>
      </aside>

      <main className="scan-main">
        <header className="scan-header">
          <div>
            <p className="scan-eyebrow">Engineering workspace</p>
            <h1>No job loaded</h1>
          </div>
          <div className="scan-header-actions">
            <Badge variant="outline">Protocol v0.1</Badge>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Capability details" />}>
                <Info aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Placement intake is available separately. Native job analysis and machine-job export are unavailable.</TooltipContent>
            </Tooltip>
            <Button disabled><FolderOpen aria-hidden="true" />Open Job</Button>
            <Button variant="outline" disabled><Search aria-hidden="true" />Analyze</Button>
          </div>
        </header>

        <div className="scan-safety-banner" role="status">
          <strong>Native job analysis is not implemented in this build.</strong>
          <span>
            Use Placement intake to read XLSX/CSV coordinates. Native job generation,
            Gerber alignment, and machine compatibility checks remain outstanding.
          </span>
        </div>

        <section className="scan-workflow" aria-label="SCAN workflow">
          {workflow.map(([step, label, state]) => (
            <div className={`scan-workflow-step ${state}`} key={step}>
              <span>{step}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </section>

        <section className="scan-grid">
          <article className="scan-panel scan-findings-panel">
            <div className="scan-panel-heading">
              <div>
                <p className="scan-eyebrow">Findings</p>
                <h2>Evidence queue</h2>
              </div>
              <Badge variant="secondary" aria-label="Findings unknown">Unknown</Badge>
            </div>
            <div className="scan-empty compact">
              <span className="scan-empty-icon" aria-hidden="true">
                <Search size={18} aria-hidden="true" />
              </span>
              <strong>Nothing to review yet</strong>
              <p>
                Load and analyze a supported local snapshot before findings can
                appear.
              </p>
            </div>
          </article>

          <article className="scan-panel scan-viewer-panel">
            <div className="scan-panel-heading">
              <div>
                <p className="scan-eyebrow">Board workspace</p>
                <h2>Inspection viewer</h2>
              </div>
              <div
                className="scan-layer-toggles"
                aria-label="Viewer layers"
              >
                {["Image", "CAD", "Gerber", "Part ROI"].map((layer) => (
                  <Badge variant="outline" className="opacity-50" key={layer}>
                    {layer}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="scan-board-placeholder">
              <div className="scan-board-grid" aria-hidden="true" />
              <div className="scan-empty">
                <span
                  className="scan-empty-icon large"
                  aria-hidden="true"
                >
                  <Layers aria-hidden="true" />
                </span>
                <strong>Board evidence will appear here</strong>
                <p>
                  Pan, zoom, overlays, exact module/RefDes/Part ID selection,
                  and before/after evidence arrive with the input adapters.
                </p>
              </div>
            </div>
          </article>

          <article className="scan-panel scan-evidence-panel">
            <div className="scan-panel-heading">
              <div>
                <p className="scan-eyebrow">Next required action</p>
                <h2>Safe input intake</h2>
              </div>
            </div>
            <ol className="scan-next-list">
              <li className="current">
                <span>1</span>
                <div>
                  <strong>Local UI foundation</strong>
                  <p>Source intake is not connected to this interface.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Read-only ZIP inventory worker</strong>
                  <p>
                    A03 provides bounded ZIP inventory; no live job is loaded here.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Select a snapshot</strong>
                  <p>
                    Keep main, Temp, and backup identities separate.
                  </p>
                </div>
              </li>
            </ol>
            <div className="scan-write-gate">
              <strong>Repair writer unavailable</strong>
              <p>
                Candidate export remains disabled until adapter compatibility
                and copy-only safety gates pass.
              </p>
              <Button variant="outline" className="mt-3 w-full" disabled>
                <LockKeyhole aria-hidden="true" />Export machine job
              </Button>
            </div>
          </article>
        </section>

        <section className="scan-coverage" aria-label="Coverage states">
          {coverage.map(([label, value]) => (
            <div className="scan-metric" key={label}>
              <span>{label}</span>
              <strong aria-label={`${label}: unknown`}>{value}</strong>
            </div>
          ))}
        </section>
        <p className="mt-3 text-xs text-muted-foreground">— means unknown, not zero. Representation, enabled inspection, teaching, verification and release are separate states.</p>
        <a href="/intake" className={buttonVariants({ className: "mt-4 mr-3" })}>Open placement intake</a>
        <a href="/demo" className={buttonVariants({ variant: "outline", className: "mt-4" })}>Explore synthetic demo</a>
      </main>
    </div>
  );
}
