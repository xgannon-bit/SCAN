"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, Info, ScanLine } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useScanSession } from "./ScanSession";

const screens = [
  { href: "/", label: "Job dashboard" },
  { href: "/intake", label: "Source intake" },
  { href: "/workspace", label: "Board workspace" },
  { href: "/findings", label: "Source findings" },
];

export function ScanShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { file, preview, result, stage } = useScanSession();
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
        {["Repair Review", "Debug Queue"].map(label => <Button key={label} variant="ghost" className="scan-nav-item" disabled><span>{label}</span><span className="scan-nav-lock">Unavailable</span></Button>)}
      </nav>
      <div className="scan-sidebar-foot"><span className="scan-status-dot" aria-hidden="true" /><div><strong>Local engineering alpha</strong><span>Shared session on this laptop</span></div></div>
    </aside>
    <main className="scan-main" id="scan-content" tabIndex={-1}>
      <header className="scan-header">
        <div><p className="scan-eyebrow">Engineering workspace</p><h1>{heading}</h1></div>
        <div className="scan-header-actions">
          <Badge variant="outline">Local session</Badge>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Capability details" />}><Info aria-hidden="true" /></TooltipTrigger>
            <TooltipContent>Placement intake and source review work locally. Native job analysis and machine-job export are unavailable.</TooltipContent>
          </Tooltip>
          <Link className={buttonVariants()} href="/intake"><FileSpreadsheet aria-hidden="true" />{file ? "Continue intake" : "Import placement file"}</Link>
        </div>
      </header>
      <div className="scan-session-strip" aria-label="Current source"><strong>{file?.name ?? "No source loaded"}</strong><span>{stage}</span></div>
      <div className="scan-safety-banner" role="status" aria-label="Native capability status"><strong>Native job preparation is unfinished.</strong><span>Gerber alignment, native job construction and Eagle/Athena compatibility checks are still required.</span></div>
      <section className="scan-workflow" aria-label="SCAN workflow">
        <Link href="/intake" className={`scan-workflow-step ${pathname === "/intake" ? "current" : ""}`}><span>01</span><strong>Source intake</strong><small>{preview ? "Read" : "Start here"}</small></Link>
        <Link href="/findings" className={`scan-workflow-step ${pathname === "/findings" ? "current" : ""}`}><span>02</span><strong>Source review</strong><small>{result ? result.status === "success" ? "Parsed" : "Needs attention" : "Pending"}</small></Link>
        <Link href="/workspace" className={`scan-workflow-step ${pathname === "/workspace" ? "current" : ""}`}><span>03</span><strong>Workspace</strong><small>{result ? "Coordinates" : "Pending"}</small></Link>
        <div className="scan-workflow-step blocked"><span>04</span><strong>Native preparation</strong><small>Unavailable</small></div>
        <div className="scan-workflow-step blocked"><span>05</span><strong>Job export</strong><small>Unavailable</small></div>
      </section>
      {children}
      <footer className="scan-session-note">This session stays available as you move between SCAN screens. Refreshing or closing the tab clears it. Download the placement record to keep a copy.</footer>
    </main>
  </div>;
}
