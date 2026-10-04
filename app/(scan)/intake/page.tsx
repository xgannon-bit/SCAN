import { PlacementIntake } from "@/components/scan/PlacementIntake";
import { ArchiveIntake } from "@/components/scan/ArchiveIntake";
import { GerberIntake } from "@/components/scan/GerberIntake";

export default function IntakePage() {
  return <div className="scan-content-stack"><div className="scan-intake-links"><a href="#source-title">Placement spreadsheet</a><a href="#gerber-intake">Gerber layer</a><a href="#archive-intake">Existing job archive</a></div><PlacementIntake /><GerberIntake /><ArchiveIntake /></div>;
}
