import { RepairReview } from "@/components/scan/RepairReview";
import { NativePreparationReview } from "@/components/scan/NativePreparationReview";
import { OfflineWorkflow } from "@/components/scan/OfflineWorkflow";
export default function RepairPage() { return <div className="scan-content-stack"><OfflineWorkflow /><NativePreparationReview /><RepairReview /></div>; }
