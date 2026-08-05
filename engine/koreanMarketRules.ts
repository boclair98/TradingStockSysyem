export type VenueId = "KRX" | "NEXTRADE";
export type KoreanMarket = "KOSPI" | "KOSDAQ";
export type MarketPhase = "CLOSED" | "PRE_MARKET" | "OPENING_AUCTION" | "CONTINUOUS" | "CLOSING_AUCTION" | "AFTER_MARKET";

export interface SessionWindow {
  phase: MarketPhase;
  start: string;
  end: string;
  label: string;
}

export interface VenueRuleProfile {
  venue: VenueId;
  name: string;
  market: KoreanMarket;
  dailyPriceLimitPercent: number;
  sessions: SessionWindow[];
  regularOrderTypes: string[];
  auctionOrderTypes: string[];
}

const KRX_SESSIONS: SessionWindow[] = [
  { phase: "OPENING_AUCTION", start: "08:30:00", end: "09:00:00", label: "Opening auction" },
  { phase: "CONTINUOUS", start: "09:00:00", end: "15:20:00", label: "Main continuous" },
  { phase: "CLOSING_AUCTION", start: "15:20:00", end: "15:30:00", label: "Closing auction" },
];

const NEXTRADE_SESSIONS: SessionWindow[] = [
  { phase: "PRE_MARKET", start: "08:00:00", end: "08:50:00", label: "NXT pre-market" },
  { phase: "CONTINUOUS", start: "09:00:30", end: "15:20:00", label: "NXT main market" },
  { phase: "AFTER_MARKET", start: "15:40:00", end: "20:00:00", label: "NXT after-market" },
];

export const KOREAN_VENUE_PROFILES: Record<VenueId, VenueRuleProfile> = {
  KRX: {
    venue: "KRX",
    name: "Korea Exchange",
    market: "KOSPI",
    dailyPriceLimitPercent: 30,
    sessions: KRX_SESSIONS,
    regularOrderTypes: ["LIMIT", "MARKET", "IOC", "FOK"],
    auctionOrderTypes: ["LIMIT", "MARKET"],
  },
  NEXTRADE: {
    venue: "NEXTRADE",
    name: "Nextrade ATS",
    market: "KOSPI",
    dailyPriceLimitPercent: 30,
    sessions: NEXTRADE_SESSIONS,
    regularOrderTypes: ["LIMIT", "MARKET", "IOC", "FOK", "MIDPOINT", "STOP_LIMIT"],
    auctionOrderTypes: ["LIMIT", "MARKET"],
  },
};

const TICK_TABLE: Array<{ upperExclusive: number; kospi: number; kosdaq: number }> = [
  { upperExclusive: 1_000, kospi: 1, kosdaq: 1 },
  { upperExclusive: 5_000, kospi: 5, kosdaq: 5 },
  { upperExclusive: 10_000, kospi: 10, kosdaq: 10 },
  { upperExclusive: 50_000, kospi: 50, kosdaq: 50 },
  { upperExclusive: 100_000, kospi: 100, kosdaq: 100 },
  { upperExclusive: 500_000, kospi: 500, kosdaq: 100 },
  { upperExclusive: Number.MAX_SAFE_INTEGER, kospi: 1_000, kosdaq: 100 },
];

export function stockTickSize(price: number, market: KoreanMarket): number {
  const row = TICK_TABLE.find((entry) => price < entry.upperExclusive);
  return market === "KOSPI" ? (row?.kospi ?? 1_000) : (row?.kosdaq ?? 100);
}

export function dailyPriceBand(basePrice: number, limitPercent = 30): { lower: number; upper: number } {
  const delta = basePrice * limitPercent / 100;
  return { lower: Math.ceil(basePrice - delta), upper: Math.floor(basePrice + delta) };
}

export function phaseForVenue(venue: VenueId, at = new Date()): MarketPhase {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const seconds = Number(parts.hour) * 3_600 + Number(parts.minute) * 60 + Number(parts.second);
  const profile = KOREAN_VENUE_PROFILES[venue];
  for (const window of profile.sessions) {
    const [start, end] = [toSeconds(window.start), toSeconds(window.end)];
    if (seconds >= start && seconds < end) return window.phase;
  }
  return "CLOSED";
}

export function phaseLabel(phase: MarketPhase): string {
  return {
    CLOSED: "Market closed",
    PRE_MARKET: "Pre-market",
    OPENING_AUCTION: "Opening auction",
    CONTINUOUS: "Continuous trading",
    CLOSING_AUCTION: "Closing auction",
    AFTER_MARKET: "After-market",
  }[phase];
}

function toSeconds(value: string): number {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3_600 + minutes * 60 + seconds;
}
