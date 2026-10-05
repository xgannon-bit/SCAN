"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, Info, ScanLine } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useScanSession } from "./ScanSession";
import { ReviewControls } from "./ReviewControls";

const screens = [
  { href: "/", label: "Job dashboard" },
  { href: "/intake", label: "Source intake" },
  { href: "/workspace", label: "Board workspace" },
  { href: "/findings", label: "Source findings" },
  { href: "/repair", label: "Repair Review" },
  { href: "/handoff", label: "Review handoff" },
];

export function ScanShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { file, preview, result, stage, archiveFile, archiveReview, archiveBusy, gerber } = useScanSession();
  const heading = screens.find(screen => screen.href === pathname)?.label ?? "SCAN";
  return <div className="scan-app">
    <a className="scan-skip-link" href="#scan-content">Skip to workspace</a>
    <aside className="scan-sidebar" aria-label="Primary navigation">
      <div className="scan-brand">
        <span className="scan-brand-mark"><ScanLine aria-hidden="true" /></span>
        <div><strong>SCAN</strong><span>Smart Component Analysis Navigator</span></div>
      </div>
      <Separator />
      <nav className="scan-nav" aria-label="SCAN screens">
        {screens.map(screen => <Link key={screen.href} href={screen.href} className={`scan-nav-item ${pathname === screen.href ? "active" : ""}`} aria-current={pathname === screen.href ? "page" : undefined}>{screen.label}</Link>)}
      </nav>
      <div className="scan-sidebar-foot"><span className="scan-status-dot" aria-hidden="true" /><div><strong>Local engineering alpha</strong><span>Local tab; save to retain work</span></div></div>
    </aside>
    <main className="scan-main" id="scan-content" tabIndex={-1}>
      <header className="scan-header">
        <div><p className="scan-eyebrow">Engineering workspace</p><h1>{heading}</h1></div>
        <div className="scan-header-actions">
          <Badge variant="outline">Local session</Badge>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Capability details" />}><Info aria-hidden="true" /></TooltipTrigger>
            <TooltipContent>Placement intake and source review work locally. Native analysis and reviewed qualification candidates are available; Eagle compatibility and inspection behavior remain unverified.</TooltipContent>
          </Tooltip>
          <Link className={buttonVariants()} href="/intake"><FileSpreadsheet aria-hidden="true" />{file ? "Continue intake" : "Import placement file"}</Link>
        </div>
      </header>
      <div className="scan-session-strip" aria-label="Current source"><strong>{file?.name ?? archiveFile?.name ?? "No source loaded"}</strong><span>{file ? stage : archiveBusy ? "Processing archive" : archiveReview ? "Archive integrity verified; native preparation held" : archiveFile ? "Archive selected" : stage}</span></div>
      <div className="scan-safety-banner" role="status" aria-label="Native capability status"><strong>Offline evaluation — machine qualification pending.</strong><span>{gerber.alignment?.status === "success" ? "CAD/Gerber control checks passed. Native job construction and Eagle/Athena compatibility remain required." : "Review CAD/Gerber alignment, native job construction and Eagle/Athena compatibility before machine use."}</span></div>
      <nav className="scan-workflow" aria-label="Import Review Export">
        <Link href="/intake" className={`scan-workflow-step ${pathname === "/intake" ? "current" : ""}`}><span>01</span><strong>Import</strong><small>Job copy and useful source files</small></Link>
        <Link href="/findings" className={`scan-workflow-step ${["/findings", "/workspace", "/repair"].includes(pathname) ? "current" : ""}`}><span>02</span><strong>Review</strong><small>Source issues, geometry and exact proposals</small></Link>
        <Link href="/handoff" className={`scan-workflow-step ${pathname === "/handoff" ? "current" : ""}`}><span>03</span><strong>Export</strong><small>Project, handoff or qualification candidate</small></Link>
      </nav>
      <ReviewControls />
      {children}
      <footer className="scan-session-note">Unsaved work stays in this tab. Save project before refreshing or closing to retain native sources, mappings, repair decisions, candidate revision receipts and work observations.</footer>
    </main>
  </div>;
}
