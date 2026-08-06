import { cancelPaperOrder, replacePaperOrder } from "../../../../engine/apiRuntime";

export async function DELETE(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const participantId = new URL(request.url).searchParams.get("participantId")?.trim() || "api-paper";
  const result = cancelPaperOrder(orderId, participantId);
  return Response.json({ venue: "NEXTRADE", mode: "paper", ...result }, {
    status: result.cancelled ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const participantId = new URL(request.url).searchParams.get("participantId")?.trim() || "api-paper";
  let payload: { quantity?: number; price?: number | null };
  try {
    payload = await request.json() as { quantity?: number; price?: number | null };
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  if (!Number.isSafeInteger(payload.quantity) || (payload.quantity ?? 0) <= 0) {
    return Response.json({ error: "quantity must be a positive integer" }, { status: 400 });
  }
  const quantity = payload.quantity as number;
  const result = replacePaperOrder(orderId, participantId, quantity, payload.price);
  return Response.json({ venue: "NEXTRADE", mode: "paper", ...result }, {
    status: result.accepted ? 200 : 422,
    headers: { "Cache-Control": "no-store" },
  });
}
