import type { OrderType, Side, TimeInForce } from "./matchingEngine";

export type MemberOrderMessage = {
  messageType: "D";
  memberId: string;
  sessionId: string;
  sequence: number;
  clientOrderId: string;
  symbol: string;
  side: Side;
  orderType: OrderType;
  timeInForce: TimeInForce;
  price: number | null;
  stopPrice?: number | null;
  quantity: number;
  sentAt: string;
};

export type GatewayRejectCode = "AUTH_FAILED" | "SESSION_INVALID" | "SEQUENCE_GAP" | "DUPLICATE_CLIENT_ORDER_ID" | "MESSAGE_INVALID" | "CLOCK_SKEW" | "RATE_LIMIT" | "VENUE_HALTED";

export type GatewayValidation = { ok: true; normalized: MemberOrderMessage } | { ok: false; code: GatewayRejectCode; message: string; expectedSequence?: number };

const MEMBER_PATTERN = /^[A-Z0-9]{4,12}$/;
const SESSION_PATTERN = /^[A-Z0-9-]{8,48}$/;
const CLIENT_ORDER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function validateMemberMessage(message: Partial<MemberOrderMessage>, expectedSequence: number, now = Date.now()): GatewayValidation {
  if (message.messageType !== "D" || !MEMBER_PATTERN.test(message.memberId ?? "") || !SESSION_PATTERN.test(message.sessionId ?? "") || !CLIENT_ORDER_PATTERN.test(message.clientOrderId ?? "")) return { ok: false, code: "MESSAGE_INVALID", message: "invalid gateway identifiers" };
  if (!Number.isSafeInteger(message.sequence) || message.sequence !== expectedSequence) return { ok: false, code: "SEQUENCE_GAP", message: "gateway sequence is not contiguous", expectedSequence };
  if (message.side !== "BUY" && message.side !== "SELL") return { ok: false, code: "MESSAGE_INVALID", message: "invalid side" };
  if (!message.symbol || !/^\d{6}$/.test(message.symbol)) return { ok: false, code: "MESSAGE_INVALID", message: "symbol must be a six-digit domestic stock code" };
  if (!message.orderType || !["LIMIT", "MARKET", "MIDPOINT", "STOP_LIMIT"].includes(message.orderType)) return { ok: false, code: "MESSAGE_INVALID", message: "invalid order type" };
  if (!message.timeInForce || !["GTC", "IOC", "FOK"].includes(message.timeInForce)) return { ok: false, code: "MESSAGE_INVALID", message: "invalid time in force" };
  if (!Number.isSafeInteger(message.quantity) || Number(message.quantity) <= 0) return { ok: false, code: "MESSAGE_INVALID", message: "quantity must be a positive integer" };
  if ((message.orderType === "LIMIT" || message.orderType === "STOP_LIMIT") && (!Number.isSafeInteger(message.price) || Number(message.price) <= 0)) return { ok: false, code: "MESSAGE_INVALID", message: "limit price is required" };
  const sentAt = Date.parse(message.sentAt ?? "");
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > 30_000) return { ok: false, code: "CLOCK_SKEW", message: "message timestamp exceeds the 30 second certification tolerance" };
  return { ok: true, normalized: message as MemberOrderMessage };
}

export function canonicalGatewayPayload(message: MemberOrderMessage) {
  return [message.messageType, message.memberId, message.sessionId, message.sequence, message.clientOrderId, message.symbol, message.side, message.orderType, message.timeInForce, message.price ?? "", message.stopPrice ?? "", message.quantity, message.sentAt].join("|");
}

export async function verifyGatewaySignature(message: MemberOrderMessage, signature: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/.{1,2}/g) ?? [], (part) => Number.parseInt(part, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(canonicalGatewayPayload(message)));
}

export function executionReport(input: { memberId: string; sessionId: string; clientOrderId: string; orderId?: string; status: string; sequence: number; reason?: string | null; executions?: Array<{ id: string; price: number; quantity: number; executedAt: string }> }) {
  return { messageType: "8", venue: "NEXTRADE", memberId: input.memberId, sessionId: input.sessionId, clientOrderId: input.clientOrderId, venueOrderId: input.orderId ?? null, executionStatus: input.status, marketSequence: input.sequence, reason: input.reason ?? null, fills: input.executions ?? [], transactTime: new Date().toISOString() };
}
