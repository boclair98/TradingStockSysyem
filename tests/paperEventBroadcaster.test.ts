import assert from "node:assert/strict";
import test from "node:test";
import { PaperEventBroadcaster, type PaperEventListener, type PaperEventSource } from "../engine/paperEventBroadcaster.js";
import type { EngineEvent } from "../engine/matchingEngine.js";

class TestEventSource implements PaperEventSource {
  subscriptions = 0;
  private readonly listeners = new Set<PaperEventListener>();

  subscribe(listener: PaperEventListener): () => void {
    this.subscriptions += 1;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

const marketEvent = (sequence: number): EngineEvent => ({
  type: "MARKET_STATE_CHANGED",
  sequence,
  venue: "NEXTRADE",
  phase: "CONTINUOUS",
  emittedAt: new Date(0).toISOString(),
});

test("broadcaster keeps subscribers across engine replacement and bridges each engine once", () => {
  const broadcaster = new PaperEventBroadcaster();
  const firstEngine = new TestEventSource();
  const replacementEngine = new TestEventSource();
  const sequences: number[] = [];
  const unsubscribe = broadcaster.subscribe((event) => sequences.push(event.sequence));

  assert.equal(broadcaster.bridge(firstEngine), true);
  assert.equal(broadcaster.bridge(firstEngine), false);
  assert.equal(broadcaster.bridge(replacementEngine), true);
  assert.equal(firstEngine.subscriptions, 1);
  assert.equal(replacementEngine.subscriptions, 1);

  firstEngine.emit(marketEvent(1));
  replacementEngine.emit(marketEvent(2));
  assert.deepEqual(sequences, [1, 2]);

  unsubscribe();
  replacementEngine.emit(marketEvent(3));
  assert.deepEqual(sequences, [1, 2]);
});

test("a failed SSE subscriber cannot abort fan-out or matching work", () => {
  const broadcaster = new PaperEventBroadcaster();
  const engine = new TestEventSource();
  const received: number[] = [];
  broadcaster.subscribe(() => { throw new Error("disconnected"); });
  broadcaster.subscribe((event) => received.push(event.sequence));
  broadcaster.bridge(engine);

  assert.doesNotThrow(() => engine.emit(marketEvent(7)));
  assert.deepEqual(received, [7]);
  assert.doesNotThrow(() => engine.emit(marketEvent(8)));
  assert.deepEqual(received, [7, 8]);
});
