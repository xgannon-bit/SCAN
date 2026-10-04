import { placementWorker, permittedOrigin } from "@/lib/scan/placement-worker";
import { boundedBody, geometryReply as reply } from "@/lib/scan/local-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!permittedOrigin(request.headers.get("origin"), request.headers.get("host"))) return reply({ message: "Use the local SCAN page." }, 403);
  if (request.headers.get("content-type") !== "application/json") return reply({ message: "Expected alignment settings." }, 400);
  try {
    return reply(await placementWorker(await boundedBody(request, 32000), { action: "align", config: {} }, request.signal, "geometry_cli"));
  } catch { return reply({ message: "Alignment could not run. Check the local worker and input limits." }, 400); }
}
