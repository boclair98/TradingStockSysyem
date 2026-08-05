import assert from "node:assert/strict";
import test from "node:test";
import { dailyPriceBand, phaseForVenue, stockTickSize } from "../engine/koreanMarketRules.js";
import { chooseBestVenue } from "../engine/smartOrderRouter.js";

test("Korean stock ticks follow KOSPI and KOSDAQ price bands", () => {
  assert.equal(stockTickSize(70000, "KOSPI"), 100);
  assert.equal(stockTickSize(120000, "KOSPI"), 500);
  assert.equal(stockTickSize(120000, "KOSDAQ"), 100);
  assert.deepEqual(dailyPriceBand(70000), { lower: 49000, upper: 91000 });
});

test("SOR selects the best displayed venue and applies tie priority", () => {
  const result = chooseBestVenue("BUY", 100, [
    { venue: "KRX", bestBid: 69900, bestAsk: 70100, displayedBidQuantity: 10, displayedAskQuantity: 100, sequence: 12 },
    { venue: "NEXTRADE", bestBid: 69900, bestAsk: 70100, displayedBidQuantity: 10, displayedAskQuantity: 50, sequence: 24 },
  ]);
  assert.equal(result.venue, "NEXTRADE");
  assert.equal(result.reason, "PRICE_TIE_PRIORITY");
  assert.equal(result.executableQuantity, 50);
});

test("Nextrade has distinct pre, main and after-market phases", () => {
  assert.equal(phaseForVenue("NEXTRADE", new Date("2026-08-05T23:00:00.000Z")), "PRE_MARKET");
  assert.equal(phaseForVenue("NEXTRADE", new Date("2026-08-05T00:30:00.000Z")), "CONTINUOUS");
  assert.equal(phaseForVenue("NEXTRADE", new Date("2026-08-05T10:00:00.000Z")), "AFTER_MARKET");
});
