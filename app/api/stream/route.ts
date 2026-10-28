import { getHydratedPaperRuntime, getPaperRuntime } from "../../../engine/apiRuntime";
import { getPaperEventBroadcaster } from "../../../engine/paperEventBroadcaster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const runtimeState = await getHydratedPaperRuntime();
  const broadcaster = getPaperEventBroadcaster();
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      send("ready", { venue: "NEXTRADE", sequence: runtimeState.engine.sequenceNumber, control: runtimeState.venueControl });
      unsubscribe = broadcaster.subscribe((event) => {
        if (event.type === "EXECUTION" || event.type === "MARKET_STATE_CHANGED" || event.type === "AUCTION_EXECUTED") send("market", event);
        else send("book", { type: "BOOK_CHANGED", sequence: event.sequence });
      });
      heartbeat = setInterval(() => send("heartbeat", { timestamp: new Date().toISOString(), sequence: getPaperRuntime().engine.sequenceNumber }), 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  request.signal.addEventListener("abort", () => {
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
  }, { once: true });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
