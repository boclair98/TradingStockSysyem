export type PaperOrderIntent = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "MIDPOINT" | "STOP_LIMIT";
  timeInForce: "GTC" | "IOC" | "FOK";
  price: number | null;
  stopPrice: number | null;
  quantity: number;
};

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hashPaperOrderIntent(intent: PaperOrderIntent) {
  return sha256Hex(JSON.stringify(intent));
}

export async function paperOrderIdFor(userId: string, idempotencyKey: string) {
  const digest = await sha256Hex(JSON.stringify([userId, idempotencyKey]));
  return `PAPER-${digest.slice(0, 32)}`;
}
