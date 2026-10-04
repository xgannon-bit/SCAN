import { placementWorker, permittedOrigin } from "@/lib/scan/placement-worker";
import { boundedBody, geometryReply as reply } from "@/lib/scan/local-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!permittedOrigin(request.headers.get("origin"), request.headers.get("host"))) return reply({ message: "Use the local SCAN page." }, 403);
  try {
    const type = request.headers.get("content-type");
    if (!type?.startsWith("multipart/form-data;")) throw new Error();
    const form = await new Response(new Uint8Array(await boundedBody(request, 8_030_000)), { headers: { "content-type": type } }).formData();
    if ([...form.keys()].length !== 2 || form.getAll("file").length !== 1 || form.getAll("config").length !== 1) throw new Error();
    const file = form.get("file"); const config = form.get("config");
    if (!(file instanceof File) || !/\.(gbr|gbx)$/i.test(file.name) || !file.size || file.size > 8_000_000 || typeof config !== "string" || config.length > 500) throw new Error();
    return reply(await placementWorker(Buffer.from(await file.arrayBuffer()), { action: "gerber", config: JSON.parse(config) }, request.signal, "geometry_cli"));
  } catch { return reply({ message: "Gerber import failed. Use a .gbr or .gbx file up to 8 MB and valid interpretation settings. Check the local worker if this persists." }, 400); }
}
