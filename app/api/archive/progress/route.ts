import { permittedOrigin } from "@/lib/scan/placement-worker";
import { readProcessing, validRunId } from "@/lib/scan/processing-journal";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const host = request.headers.get("host"), id = request.headers.get("X-SCAN-Progress") ?? "";
  let referer = ""; try { referer = new URL(request.headers.get("referer") ?? "").origin; } catch { /* Absent origin is not authority. */ }
  if (!(permittedOrigin(request.headers.get("origin"), host) || (request.headers.get("sec-fetch-site") === "same-origin" && permittedOrigin(referer, host))) || !validRunId(id)) return Response.json({ message: "Use the local processing view." }, { status: 403, headers });
  const journal = readProcessing(id);
  return Response.json(journal ?? { message: "No retained processing run." }, { status: journal ? 200 : 404, headers });
}
