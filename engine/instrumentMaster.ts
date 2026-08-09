import type { InstrumentConfig } from "./matchingEngine";

export type DemoInstrument = InstrumentConfig & { displayName: string; mark: string };

export const NEXTRADE_INSTRUMENTS: DemoInstrument[] = [
  { symbol: "005930", displayName: "삼성전자", mark: "S", tickSize: 100, lotSize: 1, minPrice: 100, maxPrice: 10_000_000, maxOrderQuantity: 1_000_000, market: "KOSPI", venue: "NEXTRADE", basePrice: 70000, dailyPriceLimitPercent: 30 },
  { symbol: "000660", displayName: "SK하이닉스", mark: "H", tickSize: 500, lotSize: 1, minPrice: 500, maxPrice: 10_000_000, maxOrderQuantity: 1_000_000, market: "KOSPI", venue: "NEXTRADE", basePrice: 180000, dailyPriceLimitPercent: 30 },
  { symbol: "035420", displayName: "NAVER", mark: "N", tickSize: 500, lotSize: 1, minPrice: 500, maxPrice: 10_000_000, maxOrderQuantity: 1_000_000, market: "KOSPI", venue: "NEXTRADE", basePrice: 220000, dailyPriceLimitPercent: 30 },
  { symbol: "005380", displayName: "현대차", mark: "H", tickSize: 500, lotSize: 1, minPrice: 500, maxPrice: 10_000_000, maxOrderQuantity: 1_000_000, market: "KOSPI", venue: "NEXTRADE", basePrice: 245000, dailyPriceLimitPercent: 30 },
  { symbol: "035720", displayName: "카카오", mark: "K", tickSize: 100, lotSize: 1, minPrice: 100, maxPrice: 10_000_000, maxOrderQuantity: 1_000_000, market: "KOSPI", venue: "NEXTRADE", basePrice: 55000, dailyPriceLimitPercent: 30 },
  { symbol: "069500", displayName: "KODEX 200", mark: "2", tickSize: 50, lotSize: 1, minPrice: 50, maxPrice: 10_000_000, maxOrderQuantity: 1_000_000, market: "KOSPI", venue: "NEXTRADE", basePrice: 39000, dailyPriceLimitPercent: 30 },
];

export const instrumentFor = (symbol: string): DemoInstrument =>
  NEXTRADE_INSTRUMENTS.find((instrument) => instrument.symbol === symbol) ?? NEXTRADE_INSTRUMENTS[0];
