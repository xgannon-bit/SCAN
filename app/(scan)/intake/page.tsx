import { PlacementIntake } from "@/components/scan/PlacementIntake";
import { ArchiveIntake } from "@/components/scan/ArchiveIntake";

export default function IntakePage() {
  return <div className="scan-content-stack"><div className="scan-intake-links"><a href="#source-title">Placement spreadsheet</a><a href="#archive-intake">Existing job archive</a></div><PlacementIntake /><ArchiveIntake /></div>;
}
