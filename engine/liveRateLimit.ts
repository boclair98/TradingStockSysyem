import { checkOrderRateLimit } from "./apiRuntime";

type LiveOperation = "account" | "cancel" | "preview" | "quote" | "reconcile" | "submit";

const LIMITS: Record<LiveOperation, { limit: number; windowMs: number }> = {
  account: { limit: 12, windowMs: 10_000 },
  cancel: { limit: 8, windowMs: 10_000 },
  preview: { limit: 8, windowMs: 10_000 },
  quote: { limit: 20, windowMs: 10_000 },
  reconcile: { limit: 2, windowMs: 10_000 },
  submit: { limit: 4, windowMs: 10_000 },
};

/**
 * Broker calls are deliberately rate-limited before a request reaches the
 * adapter. The broker remains the source of truth for its own quota; this
 * guard only protects a user session from accidental bursts per runtime.
 */
export function checkLiveRequestRateLimit(userId: string, operation: LiveOperation) {
  const config = LIMITS[operation];
  return checkOrderRateLimit(`live:${operation}:${userId}`, Date.now(), config.limit, config.windowMs);
}
