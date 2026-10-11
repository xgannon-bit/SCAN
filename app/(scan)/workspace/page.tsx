import { PlacementWorkspace } from "@/components/scan/PlacementWorkspace";
import { GerberWorkspace } from "@/components/scan/GerberWorkspace";
import { SourceRegistrationReview } from "@/components/scan/SourceRegistrationReview";
import { OriginReview } from "@/components/scan/OriginReview";

export default function WorkspacePage() {
  return <div className="scan-content-stack"><SourceRegistrationReview /><OriginReview /><GerberWorkspace /><PlacementWorkspace /></div>;
}
