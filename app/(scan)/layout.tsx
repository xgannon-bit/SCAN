import { ScanShell } from "@/components/scan/ScanShell";
import { ScanSessionProvider } from "@/components/scan/ScanSession";

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return <ScanSessionProvider><ScanShell>{children}</ScanShell></ScanSessionProvider>;
}
