import { cancelPaperOrder } from "../../../../engine/apiRuntime";

export async function DELETE(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const participantId = new URL(request.url).searchParams.get("participantId")?.trim() || "api-paper";
  const result = cancelPaperOrder(orderId, participantId);
  return Response.json({ venue: "NEXTRADE", mode: "paper", ...result }, {
    status: result.cancelled ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
