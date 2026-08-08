import type { Side, SubmitOrderInput, TimeInForce } from "./matchingEngine";

export type BrokerProvider = "paper" | "korea_investment" | "kiwoom" | "shinhan" | "samsung" | "generic";
export type BrokerMode = "paper" | "sandbox" | "production";
export type VenuePreference = "AUTO" | "KRX" | "NEXTRADE";

export interface NormalizedBrokerOrder extends SubmitOrderInput {
  venuePreference: VenuePreference;
  accountId?: string;
}

export interface NormalizedBrokerQuote {
  symbol: string;
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  bidQuantity: number;
  askQuantity: number;
  sequence: number | null;
  receivedAt: string;
  delayed: boolean;
  source: BrokerProvider;
}

export interface NormalizedBrokerExecution {
  brokerOrderId: string;
  clientOrderId: string;
  symbol: string;
  side: Side;
  price: number;
  quantity: number;
  venue: "KRX" | "NEXTRADE" | "UNKNOWN";
  executedAt: string;
}

export interface BrokerOrderEnvelope {
  clientOrderId: string;
  symbol: string;
  side: Side;
  orderType: "LIMIT" | "MARKET" | "MIDPOINT" | "STOP_LIMIT";
  timeInForce: TimeInForce;
  price: number | null;
  stopPrice: number | null;
  quantity: number;
  venuePreference: VenuePreference;
  accountId?: string;
}

export const BROKER_REQUIRED_ENV = [
  "BROKER_API_BASE_URL",
  "BROKER_WEBSOCKET_URL",
  "BROKER_APP_KEY",
  "BROKER_APP_SECRET",
  "BROKER_ACCOUNT_ID",
] as const;

type RuntimeEnv = Record<string, string | undefined>;

const runtimeEnv = (): RuntimeEnv => typeof process === "undefined" ? {} : process.env;

const parseProvider = (value?: string): BrokerProvider => {
  if (value === "korea_investment" || value === "kiwoom" || value === "shinhan" || value === "samsung" || value === "generic") return value;
  return "paper";
};

const parseMode = (value?: string, provider: BrokerProvider = "paper"): BrokerMode => {
  if (provider === "paper") return "paper";
  if (value === "production") return "production";
  return "sandbox";
};

const parseVenue = (value?: string): VenuePreference => {
  if (value === "KRX" || value === "NEXTRADE") return value;
  return "AUTO";
};

export interface BrokerReadiness {
  provider: BrokerProvider;
  mode: BrokerMode;
  status: "paper_only" | "blocked" | "adapter_pending";
  configured: boolean;
  venuePreference: VenuePreference;
  orderEntry: "paper" | "not_connected";
  marketData: "paper" | "not_connected";
  account: "paper_limits" | "not_connected";
  missing: string[];
  capabilities: {
    orderSubmit: boolean;
    orderCancelReplace: boolean;
    realtimeQuotes: boolean;
    balances: boolean;
    positions: boolean;
    venueSelection: boolean;
  };
  nextSteps: string[];
}

export function getBrokerReadiness(env: RuntimeEnv = runtimeEnv()): BrokerReadiness {
  const provider = parseProvider(env.BROKER_PROVIDER);
  const mode = parseMode(env.BROKER_MODE, provider);
  const venuePreference = parseVenue(env.BROKER_VENUE_PREFERENCE);
  const missing = provider === "paper" ? [] : BROKER_REQUIRED_ENV.filter((key) => !env[key]?.trim());
  const configured = provider !== "paper" && missing.length === 0;
  const status = provider === "paper" ? "paper_only" : missing.length ? "blocked" : "adapter_pending";

  return {
    provider,
    mode,
    status,
    configured,
    venuePreference,
    orderEntry: provider === "paper" ? "paper" : "not_connected",
    marketData: provider === "paper" ? "paper" : "not_connected",
    account: provider === "paper" ? "paper_limits" : "not_connected",
    missing: [...missing],
    capabilities: {
      orderSubmit: provider === "paper",
      orderCancelReplace: provider === "paper",
      realtimeQuotes: false,
      balances: false,
      positions: false,
      venueSelection: venuePreference !== "AUTO" && provider === "paper",
    },
    nextSteps: provider === "paper"
      ? ["연동할 증권사를 선택하고 공식 OpenAPI 문서와 sandbox 계정을 등록하세요."]
      : missing.length
        ? ["누락된 BROKER 환경변수를 배포 환경에 등록하세요."]
        : [`${provider} 공식 주문·시세 규격에 맞춘 전송 어댑터와 sandbox 검증이 필요합니다.`],
  };
}

export function toBrokerOrderEnvelope(input: NormalizedBrokerOrder): BrokerOrderEnvelope {
  return {
    clientOrderId: input.id,
    symbol: input.symbol,
    side: input.side,
    orderType: input.type,
    timeInForce: input.timeInForce ?? (input.type === "MARKET" ? "IOC" : "GTC"),
    price: input.price ?? null,
    stopPrice: input.stopPrice ?? null,
    quantity: input.quantity,
    venuePreference: input.venuePreference,
    accountId: input.accountId,
  };
}

export function redactBrokerConfig(env: RuntimeEnv = runtimeEnv()) {
  const readiness = getBrokerReadiness(env);
  return {
    provider: readiness.provider,
    mode: readiness.mode,
    venuePreference: readiness.venuePreference,
    apiBaseUrlConfigured: Boolean(env.BROKER_API_BASE_URL?.trim()),
    websocketConfigured: Boolean(env.BROKER_WEBSOCKET_URL?.trim()),
    credentialsConfigured: Boolean(env.BROKER_APP_KEY?.trim() && env.BROKER_APP_SECRET?.trim()),
    accountConfigured: Boolean(env.BROKER_ACCOUNT_ID?.trim()),
  };
}
