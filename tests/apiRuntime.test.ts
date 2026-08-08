import assert from "node:assert/strict";
import test from "node:test";
import { withTradingMutationLock } from "../engine/apiRuntime.js";

test("trading mutations execute in arrival order without overlap", async () => {
  const timeline: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const mutation = (name: string, delay: number) => withTradingMutationLock(async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    timeline.push(`${name}:start`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    timeline.push(`${name}:end`);
    concurrent -= 1;
  });
  await Promise.all([mutation("first", 15), mutation("second", 1), mutation("third", 1)]);
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(timeline, ["first:start", "first:end", "second:start", "second:end", "third:start", "third:end"]);
});
