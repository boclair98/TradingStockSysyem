import { dailyPriceBand, phaseLabel, stockTickSize, type KoreanMarket, type MarketPhase, type VenueId } from "./koreanMarketRules";

export type Side = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type TimeInForce = "GTC" | "IOC" | "FOK";
export type OrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED";
export type SelfTradePolicy = "CANCEL_TAKER" | "CANCEL_MAKER";

export interface InstrumentConfig {
  symbol: string;
  tickSize: number;
  lotSize: number;
  minPrice: number;
  maxPrice: number;
  maxOrderQuantity: number;
  market?: KoreanMarket;
  venue?: VenueId;
  basePrice?: number;
  dailyPriceLimitPercent?: number;
}

export interface Order {
  id: string;
  symbol: string;
  participantId: string;
  side: Side;
  type: OrderType;
  timeInForce: TimeInForce;
  price: number | null;
  quantity: number;
  remaining: number;
  status: OrderStatus;
  sequence: number;
  acceptedAt: string;
  lastUpdatedAt: string;
  replacesOrderId?: string;
}

export interface SubmitOrderInput {
  id: string;
  symbol: string;
  participantId: string;
  side: Side;
  type: OrderType;
  timeInForce?: TimeInForce;
  price?: number | null;
  quantity: number;
}

export interface Execution {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  buyOrderId: string;
  sellOrderId: string;
  makerOrderId: string;
  takerOrderId: string;
  sequence: number;
  executedAt: string;
}

export interface BookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface BookSnapshot {
  symbol: string;
  bids: Order[];
  asks: Order[];
  bidLevels: BookLevel[];
  askLevels: BookLevel[];
  sequence: number;
  phase: MarketPhase;
}

export interface MarketState {
  venue: VenueId;
  phase: MarketPhase;
  label: string;
  sequence: number;
}

export type EngineEvent =
  | { type: "ORDER_ACCEPTED"; sequence: number; order: Order }
  | { type: "ORDER_REJECTED"; sequence: number; orderId: string; symbol: string; reason: string; emittedAt: string }
  | { type: "EXECUTION"; sequence: number; execution: Execution }
  | { type: "ORDER_CANCELLED"; sequence: number; order: Order; reason: string }
  | { type: "ORDER_REPLACED"; sequence: number; oldOrderId: string; newOrder: Order; emittedAt: string }
  | { type: "SELF_TRADE_PREVENTED"; sequence: number; takerOrderId: string; makerOrderId: string; policy: SelfTradePolicy; emittedAt: string }
  | { type: "MARKET_STATE_CHANGED"; sequence: number; venue: VenueId; phase: MarketPhase; emittedAt: string };

export interface SubmitOrderResult {
  accepted: boolean;
  order: Order | null;
  executions: Execution[];
  reason?: string;
}

export interface CancelResult {
  cancelled: boolean;
  order?: Order;
  reason?: string;
}

type Book = { bids: Map<string, Order>; asks: Map<string, Order> };
type Listener = (event: EngineEvent) => void;

const nowIso = () => new Date().toISOString();
const cloneOrder = (order: Order): Order => ({ ...order });

const DEFAULT_INSTRUMENT: Omit<InstrumentConfig, "symbol"> = {
  tickSize: 1,
  lotSize: 1,
  minPrice: 1,
  maxPrice: Number.MAX_SAFE_INTEGER,
  maxOrderQuantity: Number.MAX_SAFE_INTEGER,
};

/**
 * Deterministic price/time-priority matching core.
 *
 * The engine is deliberately transport-agnostic: it owns matching decisions,
 * order state and an append-only event stream. REST/FIX/WebSocket gateways,
 * persistence, risk and clearing belong outside this class.
 */
export class MatchingEngine {
  private readonly books = new Map<string, Book>();
  private readonly orders = new Map<string, Order>();
  private readonly instruments = new Map<string, InstrumentConfig>();
  private readonly eventLog: EngineEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private sequence = 0;
  private marketPhase: MarketPhase = "CONTINUOUS";

  constructor(
    private readonly selfTradePolicy: SelfTradePolicy = "CANCEL_TAKER",
    instruments: InstrumentConfig[] = [],
    private readonly venue: VenueId = "NEXTRADE",
  ) {
    for (const instrument of instruments) this.registerInstrument(instrument);
  }

  setMarketPhase(phase: MarketPhase): void {
    if (phase === this.marketPhase) return;
    this.marketPhase = phase;
    this.emit({ type: "MARKET_STATE_CHANGED", sequence: this.nextSequence(), venue: this.venue, phase, emittedAt: nowIso() });
  }

  getMarketState(): MarketState {
    return { venue: this.venue, phase: this.marketPhase, label: phaseLabel(this.marketPhase), sequence: this.sequence };
  }

  registerInstrument(config: InstrumentConfig): void {
    if (!config.symbol || !Number.isSafeInteger(config.tickSize) || config.tickSize <= 0) throw new Error("invalid tick size");
    if (!Number.isSafeInteger(config.lotSize) || config.lotSize <= 0) throw new Error("invalid lot size");
    if (!Number.isSafeInteger(config.minPrice) || !Number.isSafeInteger(config.maxPrice) || config.minPrice <= 0 || config.maxPrice < config.minPrice) throw new Error("invalid price band");
    if (!Number.isSafeInteger(config.maxOrderQuantity) || config.maxOrderQuantity < config.lotSize) throw new Error("invalid quantity limit");
    this.instruments.set(config.symbol, { ...config });
  }

  submit(input: SubmitOrderInput): SubmitOrderResult {
    const timeInForce = input.timeInForce ?? (input.type === "MARKET" ? "IOC" : "GTC");
    const validation = this.validate(input, timeInForce);
    if (validation) {
      this.emit({ type: "ORDER_REJECTED", sequence: this.nextSequence(), orderId: input.id, symbol: input.symbol, reason: validation, emittedAt: nowIso() });
      return { accepted: false, order: null, executions: [], reason: validation };
    }
    if (this.orders.has(input.id)) {
      const reason = "duplicate order id";
      this.emit({ type: "ORDER_REJECTED", sequence: this.nextSequence(), orderId: input.id, symbol: input.symbol, reason, emittedAt: nowIso() });
      return { accepted: false, order: null, executions: [], reason };
    }

    const book = this.getBook(input.symbol);
    const order: Order = {
      id: input.id,
      symbol: input.symbol,
      participantId: input.participantId.trim(),
      side: input.side,
      type: input.type,
      timeInForce,
      price: input.type === "LIMIT" ? input.price ?? null : null,
      quantity: input.quantity,
      remaining: input.quantity,
      status: "OPEN",
      sequence: this.nextSequence(),
      acceptedAt: nowIso(),
      lastUpdatedAt: nowIso(),
    };
    this.orders.set(order.id, order);
    this.emit({ type: "ORDER_ACCEPTED", sequence: order.sequence, order: cloneOrder(order) });

    // FOK is an all-or-none instruction. It never changes the book unless the
    // full quantity can be executed against currently executable liquidity.
    if (timeInForce === "FOK" && this.availableQuantity(order, book) < order.quantity) {
      order.remaining = order.quantity;
      order.status = "CANCELLED";
      order.lastUpdatedAt = nowIso();
      this.emitCancelled(order, "FOK_NOT_FILLED");
      return { accepted: true, order: cloneOrder(order), executions: [], reason: "FOK_NOT_FILLED" };
    }

    const executions: Execution[] = [];
    for (const maker of this.sortedOpposite(book, order.side)) {
      if (order.remaining === 0 || !this.crosses(order, maker)) break;

      if (maker.participantId === order.participantId) {
        this.emit({ type: "SELF_TRADE_PREVENTED", sequence: this.nextSequence(), takerOrderId: order.id, makerOrderId: maker.id, policy: this.selfTradePolicy, emittedAt: nowIso() });
        if (this.selfTradePolicy === "CANCEL_MAKER") {
          this.removeFromBook(book, maker);
          maker.status = "CANCELLED";
          maker.lastUpdatedAt = nowIso();
          this.emitCancelled(maker, "SELF_TRADE_PREVENTION");
          continue;
        }
        order.status = "CANCELLED";
        order.lastUpdatedAt = nowIso();
        this.emitCancelled(order, "SELF_TRADE_PREVENTION");
        break;
      }

      const quantity = Math.min(order.remaining, maker.remaining);
      maker.remaining -= quantity;
      order.remaining -= quantity;
      maker.status = maker.remaining === 0 ? "FILLED" : "PARTIAL";
      maker.lastUpdatedAt = nowIso();
      const execution: Execution = {
        id: `E-${String(this.nextSequence()).padStart(12, "0")}`,
        symbol: order.symbol,
        price: maker.price as number,
        quantity,
        buyOrderId: order.side === "BUY" ? order.id : maker.id,
        sellOrderId: order.side === "SELL" ? order.id : maker.id,
        makerOrderId: maker.id,
        takerOrderId: order.id,
        sequence: this.sequence,
        executedAt: nowIso(),
      };
      executions.push(execution);
      this.emit({ type: "EXECUTION", sequence: execution.sequence, execution });
      if (maker.remaining === 0) this.removeFromBook(book, maker);
    }

    if (order.status !== "CANCELLED") {
      order.status = order.remaining === 0 ? "FILLED" : executions.length ? "PARTIAL" : "OPEN";
      order.lastUpdatedAt = nowIso();
      if (order.remaining > 0 && order.type === "LIMIT" && timeInForce === "GTC") this.addToBook(book, order);
      if (order.remaining > 0 && (order.type === "MARKET" || timeInForce === "IOC")) {
        order.status = "CANCELLED";
        order.lastUpdatedAt = nowIso();
        this.emitCancelled(order, timeInForce === "IOC" ? "IOC_REMAINDER" : "MARKET_REMAINDER");
      }
    }
    return { accepted: true, order: cloneOrder(order), executions };
  }

  cancel(orderId: string, participantId?: string, reason = "USER_REQUEST"): CancelResult {
    const order = this.orders.get(orderId);
    if (!order) return { cancelled: false, reason: "order not found" };
    if (participantId && order.participantId !== participantId) return { cancelled: false, reason: "participant mismatch" };
    if (order.status === "FILLED" || order.status === "CANCELLED" || order.status === "REJECTED") return { cancelled: false, reason: "order is not cancellable" };
    this.removeFromBook(this.getBook(order.symbol), order);
    order.status = "CANCELLED";
    order.lastUpdatedAt = nowIso();
    this.emitCancelled(order, reason);
    return { cancelled: true, order: cloneOrder(order) };
  }

  replace(orderId: string, quantity: number, price?: number | null, participantId?: string): SubmitOrderResult {
    const current = this.orders.get(orderId);
    if (!current) return { accepted: false, order: null, executions: [], reason: "order not found" };
    if (participantId && current.participantId !== participantId) return { accepted: false, order: null, executions: [], reason: "participant mismatch" };
    if (current.status === "FILLED" || current.status === "CANCELLED" || current.status === "REJECTED") return { accepted: false, order: null, executions: [], reason: "order is not replaceable" };
    const filled = current.quantity - current.remaining;
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity < filled) return { accepted: false, order: null, executions: [], reason: "replacement quantity cannot be below filled quantity" };
    const cancelled = this.cancel(orderId, participantId, "REPLACED");
    if (!cancelled.cancelled) return { accepted: false, order: null, executions: [], reason: cancelled.reason };
    const replacementId = `${orderId}-R${this.sequence + 1}`;
    const result = this.submit({ id: replacementId, symbol: current.symbol, participantId: current.participantId, side: current.side, type: current.type, timeInForce: current.timeInForce, quantity, price: current.type === "LIMIT" ? price ?? current.price : null });
    if (result.order) {
      result.order.replacesOrderId = orderId;
      const stored = this.orders.get(result.order.id);
      if (stored) stored.replacesOrderId = orderId;
      this.emit({ type: "ORDER_REPLACED", sequence: this.nextSequence(), oldOrderId: orderId, newOrder: cloneOrder(stored ?? result.order), emittedAt: nowIso() });
    }
    return result;
  }

  snapshot(symbol: string): BookSnapshot {
    const book = this.getBook(symbol);
    const bids = this.sorted(book.bids, "BUY").map(cloneOrder);
    const asks = this.sorted(book.asks, "SELL").map(cloneOrder);
    return {
      symbol,
      bids,
      asks,
      bidLevels: this.aggregateLevels(bids),
      askLevels: this.aggregateLevels(asks),
      sequence: this.sequence,
      phase: this.marketPhase,
    };
  }

  getOrder(orderId: string): Order | undefined {
    const order = this.orders.get(orderId);
    return order ? cloneOrder(order) : undefined;
  }

  getEvents(afterSequence = 0): EngineEvent[] {
    return this.eventLog.filter((event) => event.sequence > afterSequence).map((event) => {
      if (event.type === "ORDER_ACCEPTED") return { ...event, order: cloneOrder(event.order) };
      if (event.type === "EXECUTION") return { ...event, execution: { ...event.execution } };
      if (event.type === "ORDER_CANCELLED") return { ...event, order: cloneOrder(event.order) };
      if (event.type === "ORDER_REPLACED") return { ...event, newOrder: cloneOrder(event.newOrder) };
      return { ...event };
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get sequenceNumber(): number {
    return this.sequence;
  }

  private getBook(symbol: string): Book {
    let book = this.books.get(symbol);
    if (!book) {
      book = { bids: new Map(), asks: new Map() };
      this.books.set(symbol, book);
    }
    return book;
  }

  private instrument(symbol: string): InstrumentConfig {
    return this.instruments.get(symbol) ?? { symbol, ...DEFAULT_INSTRUMENT };
  }

  private validate(input: SubmitOrderInput, timeInForce: TimeInForce): string | undefined {
    if (!input.id || !input.symbol || !input.participantId?.trim()) return "id, symbol, participantId are required";
    if (this.marketPhase === "CLOSED") return "market is closed";
    if (input.side !== "BUY" && input.side !== "SELL") return "side must be BUY or SELL";
    if (input.type !== "LIMIT" && input.type !== "MARKET") return "type must be LIMIT or MARKET";
    if (!["GTC", "IOC", "FOK"].includes(timeInForce)) return "unsupported time in force";
    const instrument = this.instrument(input.symbol);
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity % instrument.lotSize !== 0) return `quantity must be a positive multiple of ${instrument.lotSize}`;
    if (input.quantity > instrument.maxOrderQuantity) return `quantity exceeds max ${instrument.maxOrderQuantity}`;
    if (input.type === "LIMIT") {
      if (!Number.isSafeInteger(input.price) || (input.price as number) < instrument.minPrice || (input.price as number) > instrument.maxPrice) return "limit price is outside the configured band";
      const tickSize = instrument.market ? stockTickSize(input.price as number, instrument.market) : instrument.tickSize;
      if ((input.price as number) % tickSize !== 0) return `price must be a multiple of ${tickSize}`;
      if (instrument.basePrice) {
        const band = dailyPriceBand(instrument.basePrice, instrument.dailyPriceLimitPercent ?? 30);
        if ((input.price as number) < band.lower || (input.price as number) > band.upper) return `price must be within ${band.lower}-${band.upper}`;
      }
    }
    if (input.type === "MARKET" && input.price != null) return "market order cannot include a price";
    if (input.type === "MARKET" && timeInForce === "GTC") return "market order must be IOC or FOK";
    if ((this.marketPhase === "OPENING_AUCTION" || this.marketPhase === "CLOSING_AUCTION") && timeInForce !== "GTC") return "IOC/FOK are not accepted during auction phases";
    if ((this.marketPhase === "PRE_MARKET" || this.marketPhase === "AFTER_MARKET") && input.type === "MARKET") return "market orders are disabled in off-hours phases";
    return undefined;
  }

  private availableQuantity(taker: Order, book: Book): number {
    let available = 0;
    for (const maker of this.sortedOpposite(book, taker.side)) {
      if (!this.crosses(taker, maker)) break;
      if (maker.participantId !== taker.participantId) available += maker.remaining;
      if (available >= taker.quantity) return available;
    }
    return available;
  }

  private crosses(taker: Order, maker: Order): boolean {
    if (taker.type === "MARKET") return true;
    return taker.side === "BUY" ? (maker.price as number) <= (taker.price as number) : (maker.price as number) >= (taker.price as number);
  }

  private sortedOpposite(book: Book, side: Side): Order[] {
    return this.sorted(side === "BUY" ? book.asks : book.bids, side === "BUY" ? "SELL" : "BUY");
  }

  private sorted(source: Map<string, Order>, side: Side): Order[] {
    return [...source.values()].filter((order) => order.remaining > 0 && order.status !== "CANCELLED").sort((a, b) => {
      const priceCompare = side === "BUY" ? (b.price as number) - (a.price as number) : (a.price as number) - (b.price as number);
      return priceCompare || a.sequence - b.sequence;
    });
  }

  private aggregateLevels(orders: Order[]): BookLevel[] {
    const levels = new Map<number, BookLevel>();
    for (const order of orders) {
      const current = levels.get(order.price as number);
      if (current) {
        current.quantity += order.remaining;
        current.orderCount += 1;
      } else {
        levels.set(order.price as number, { price: order.price as number, quantity: order.remaining, orderCount: 1 });
      }
    }
    return [...levels.values()];
  }

  private addToBook(book: Book, order: Order): void {
    (order.side === "BUY" ? book.bids : book.asks).set(order.id, order);
  }

  private removeFromBook(book: Book, order: Order): void {
    (order.side === "BUY" ? book.bids : book.asks).delete(order.id);
  }

  private emitCancelled(order: Order, reason: string): void {
    this.emit({ type: "ORDER_CANCELLED", sequence: this.nextSequence(), order: cloneOrder(order), reason });
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private emit(event: EngineEvent): void {
    this.eventLog.push(event);
    for (const listener of this.listeners) listener(event);
  }
}
