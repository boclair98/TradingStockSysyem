import { getPaperRuntime, submitPaperOrder } from "../../../engine/apiRuntime";
import { getBrokerReadiness, toBrokerOrderEnvelope, type VenuePreference } from "../../../engine/brokerGateway";
import type { OrderType, Side, TimeInForce } from "../../../engine/matchingEngine";
import { instrumentFor } from "../../../engine/instrumentMaster";

export const dynamic = "force-dynamic";

type OrderPayload = {
  id?: string;
  symbol?: string;
  participantId?: string;
  side?: Side;
  type?: OrderType;
  timeInForce?: TimeInForce;
  price?: number | null;
  stopPrice?: number | null;
  quantity?: number;
  live?: boolean;
  accountId?: string;
  venuePreference?: VenuePreference;
};

const isSide = (value: unknown): value is Side => value === "BUY" || value === "SELL";
const isOrderType = (value: unknown): value is OrderType => value === "LIMIT" || value === "MARKET" || value === "MIDPOINT" || value === "STOP_LIMIT";
const isTif = (value: unknown): value is TimeInForce => value === "GTC" || value === "IOC" || value === "FOK";
const isVenuePreference = (value: unknown): value is VenuePreference => value === "AUTO" || value === "KRX" || value === "NEXTRADE";

export async function GET() {
  const runtime = getPaperRuntime();
  const broker = getBrokerReadiness();
  return Response.json({
    targetVenue: "NEXTRADE",
    integrationModel: "securities_broker_api",
    broker: { provider: broker.provider, mode: broker.mode, status: broker.status },
    mode: "paper",
    orders: [...runtime.orders.values()].slice(-100),
    executions: runtime.executions.slice(0, 100),
    events: runtime.engine.getEvents().slice(-100),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let payload: OrderPayload;
  try {
    payload = await request.json() as OrderPayload;
  } catch {
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const broker = getBrokerReadiness();
  if (payload.live === true) {
    return Response.json({
      error: broker.configured
        ? "selected securities-company adapter is configured but its official transport is not implemented yet"
        : "live broker routing is disabled until a securities-company sandbox is configured",
      broker,
    }, { status: broker.configured ? 501 : 409 });
  }

  const symbol = payload.symbol?.trim() ?? "";
  const instrument = instrumentFor(symbol);
  if (instrument.symbol !== symbol) return Response.json({ error: "unsupported symbol" }, { status: 400 });
  if (!isSide(payload.side)) return Response.json({ error: "side must be BUY or SELL" }, { status: 400 });
  if (!isOrderType(payload.type)) return Response.json({ error: "type must be LIMIT or MARKET" }, { status: 400 });
  if (payload.timeInForce !== undefined && !isTif(payload.timeInForce)) return Response.json({ error: "invalid timeInForce" }, { status: 400 });
  if (payload.venuePreference !== undefined && !isVenuePreference(payload.venuePreference)) return Response.json({ error: "venuePreference must be AUTO, KRX, or NEXTRADE" }, { status: 400 });
  if (!Number.isSafeInteger(payload.quantity) || (payload.quantity ?? 0) <= 0) return Response.json({ error: "quantity must be a positive integer" }, { status: 400 });
  const quantity = payload.quantity as number;

  const normalizedOrder = {
    id: payload.id?.trim() || `API-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    participantId: payload.participantId?.trim() || "api-paper",
    side: payload.side,
    type: payload.type,
    timeInForce: payload.type === "MARKET" ? "IOC" : payload.timeInForce ?? "GTC",
    price: payload.type === "MARKET" || payload.type === "MIDPOINT" ? null : payload.price ?? null,
    stopPrice: payload.type === "STOP_LIMIT" ? payload.stopPrice ?? null : null,
    quantity,
    venuePreference: payload.venuePreference ?? broker.venuePreference,
    accountId: payload.accountId?.trim() || undefined,
  } as const;
  const result = submitPaperOrder(normalizedOrder);
  const brokerOrder = toBrokerOrderEnvelope(normalizedOrder);

  return Response.json({ targetVenue: brokerOrder.venuePreference, integrationModel: "securities_broker_api", broker: broker.provider, mode: "paper", brokerOrder, ...result }, {
    status: result.accepted ? 201 : 422,
    headers: { "Cache-Control": "no-store" },
  });
}
