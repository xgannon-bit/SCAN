import { PlacementWorkspace } from "@/components/scan/PlacementWorkspace";
import { GerberWorkspace } from "@/components/scan/GerberWorkspace";

export default function WorkspacePage() {
  return <div className="scan-content-stack"><GerberWorkspace /><PlacementWorkspace /></div>;
}
