import type { Side } from "./matchingEngine";
import type { VenueId } from "./koreanMarketRules";

export interface VenueQuote {
  venue: VenueId;
  bestBid: number | null;
  bestAsk: number | null;
  displayedBidQuantity: number;
  displayedAskQuantity: number;
  sequence: number;
}

export interface RouteDecision {
  venue: VenueId | null;
  reason: "BEST_DISPLAYED_PRICE" | "PRICE_TIE_PRIORITY" | "NO_EXECUTABLE_QUOTE";
  executablePrice: number | null;
  executableQuantity: number;
  quoteSequence: number | null;
}

/**
 * Deterministic SOR decision layer. It selects a venue from already received
 * quotes; it never opens sockets or submits an order. The API gateway can use
 * this decision later to send the command to KRX or Nextrade.
 */
export function chooseBestVenue(side: Side, quantity: number, quotes: VenueQuote[], priority: VenueId[] = ["NEXTRADE", "KRX"]): RouteDecision {
  const executable = quotes
    .map((quote) => ({
      quote,
      price: side === "BUY" ? quote.bestAsk : quote.bestBid,
      available: side === "BUY" ? quote.displayedAskQuantity : quote.displayedBidQuantity,
    }))
    .filter((candidate) => candidate.price != null && candidate.available > 0)
    .sort((a, b) => {
      const priceCompare = side === "BUY" ? (a.price as number) - (b.price as number) : (b.price as number) - (a.price as number);
      if (priceCompare) return priceCompare;
      return priority.indexOf(a.quote.venue) - priority.indexOf(b.quote.venue);
    });

  const best = executable[0];
  if (!best) return { venue: null, reason: "NO_EXECUTABLE_QUOTE", executablePrice: null, executableQuantity: 0, quoteSequence: null };
  return {
    venue: best.quote.venue,
    reason: executable.length > 1 && executable[1].price === best.price ? "PRICE_TIE_PRIORITY" : "BEST_DISPLAYED_PRICE",
    executablePrice: best.price as number,
    executableQuantity: Math.min(quantity, best.available),
    quoteSequence: best.quote.sequence,
  };
}
