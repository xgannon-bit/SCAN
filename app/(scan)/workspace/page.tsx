import { PlacementWorkspace } from "@/components/scan/PlacementWorkspace";
import { GerberWorkspace } from "@/components/scan/GerberWorkspace";
import { SourceRegistrationReview } from "@/components/scan/SourceRegistrationReview";

export default function WorkspacePage() {
  return <div className="scan-content-stack"><SourceRegistrationReview /><GerberWorkspace /><PlacementWorkspace /></div>;
}
