import { ReviewHandoff } from "@/components/scan/ReviewHandoff";
import { ProjectStatus } from "@/components/scan/ProjectStatus";
import { BomReview } from "@/components/scan/BomReview";

export default function HandoffPage() { return <div className="scan-content-stack"><ProjectStatus exporting /><BomReview /><ReviewHandoff /></div>; }
