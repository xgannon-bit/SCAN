export async function boundedBody(request: Request, maximum: number): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (!request.body || (length && (!/^\d+$/.test(length) || Number(length) > maximum))) throw new Error("Request exceeds its size limit.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new Error("Request exceeds its size limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export const geometryReply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
