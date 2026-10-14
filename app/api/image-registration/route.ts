import { placementWorker, permittedOrigin } from "@/lib/scan/placement-worker";
import { boundedBody, geometryReply as reply } from "@/lib/scan/local-request";
import { validateImageRegistrationRequest } from "@/lib/scan/image-registration";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!permittedOrigin(request.headers.get("origin"), request.headers.get("host"))) return reply({ message: "Use the local SCAN page." }, 403);
  if (request.headers.get("content-type") !== "application/json") return reply({ message: "Expected image registration evidence." }, 400);
  try {
    const bytes = await boundedBody(request, 64000);
    validateImageRegistrationRequest(JSON.parse(bytes.toString("utf8")));
    return reply(await placementWorker(bytes, { action: "image-register", config: {} }, request.signal, "geometry_cli"));
  } catch { return reply({ message: "Image registration is held: malformed evidence, worker unavailable or request interrupted." }, 400); }
}
