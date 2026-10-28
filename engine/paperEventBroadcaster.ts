import type { EngineEvent } from "./matchingEngine";

export type PaperEventListener = (event: EngineEvent) => void;

export interface PaperEventSource {
  subscribe(listener: PaperEventListener): () => void;
}

/**
 * Process-local fan-out for Paper matching events.
 *
 * Paper runtimes are deliberately rebuilt from PostgreSQL before each write.
 * SSE clients therefore subscribe here instead of to one short-lived engine.
 */
export class PaperEventBroadcaster {
  private readonly listeners = new Set<PaperEventListener>();
  private readonly bridgedSources = new WeakSet<object>();

  bridge(source: PaperEventSource): boolean {
    const identity = source as object;
    if (this.bridgedSources.has(identity)) return false;

    this.bridgedSources.add(identity);
    try {
      source.subscribe((event) => this.publish(event));
      return true;
    } catch (error) {
      this.bridgedSources.delete(identity);
      throw error;
    }
  }

  subscribe(listener: PaperEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: EngineEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A disconnected client must never abort the matching mutation that
        // produced the event. Drop that subscriber and continue fan-out.
        this.listeners.delete(listener);
      }
    }
  }
}

type BroadcasterGlobal = typeof globalThis & {
  __tradingStockSysyemPaperEventBroadcaster?: PaperEventBroadcaster;
};

const globalBroadcaster = globalThis as BroadcasterGlobal;

export function getPaperEventBroadcaster(): PaperEventBroadcaster {
  const current = globalBroadcaster.__tradingStockSysyemPaperEventBroadcaster;
  if (current && typeof current.bridge === "function" && typeof current.subscribe === "function") return current;

  const broadcaster = new PaperEventBroadcaster();
  globalBroadcaster.__tradingStockSysyemPaperEventBroadcaster = broadcaster;
  return broadcaster;
}

export function bridgePaperEventSource(source: PaperEventSource): void {
  getPaperEventBroadcaster().bridge(source);
}
