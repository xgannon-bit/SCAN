import { BomReview } from "@/components/scan/BomReview";
import { ProjectStatus } from "@/components/scan/ProjectStatus";
import { NativeAccounting } from "@/components/scan/NativeAccounting";
import { PlacementFindings } from "@/components/scan/PlacementFindings";
import { GerberFindings } from "@/components/scan/GerberFindings";

export default function FindingsPage() {
  return <div className="scan-content-stack"><ProjectStatus /><BomReview /><GerberFindings /><PlacementFindings /><NativeAccounting /></div>;
}
