import { CandidateWorkPanel } from "@/components/scan/CandidateWorkPanel";
import { RepairReview } from "@/components/scan/RepairReview";
import { NativePreparationReview } from "@/components/scan/NativePreparationReview";
import { OfflineWorkflow } from "@/components/scan/OfflineWorkflow";
import { NativeDiagnosisReview } from "@/components/scan/NativeDiagnosisReview";
export default function RepairPage() { return <div className="scan-content-stack"><OfflineWorkflow /><CandidateWorkPanel /><NativeDiagnosisReview /><NativePreparationReview /><RepairReview /></div>; }
