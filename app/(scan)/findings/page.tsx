import { PlacementFindings } from "@/components/scan/PlacementFindings";
import { GerberFindings } from "@/components/scan/GerberFindings";

export default function FindingsPage() {
  return <div className="scan-content-stack"><GerberFindings /><PlacementFindings /></div>;
}
