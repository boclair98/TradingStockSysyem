export type NextradeMode = "disabled" | "sandbox" | "production";

export const NEXTRADE_REQUIRED_ENV = [
  "NEXTRADE_API_BASE_URL",
  "NEXTRADE_MARKET_DATA_URL",
  "NEXTRADE_PARTICIPANT_ID",
  "NEXTRADE_API_KEY",
  "NEXTRADE_API_SECRET",
] as const;

type RuntimeEnv = Record<string, string | undefined>;

const runtimeEnv = (): RuntimeEnv =>
  typeof process === "undefined" ? {} : process.env;

const readMode = (value: string | undefined): NextradeMode => {
  if (value === "sandbox" || value === "production") return value;
  return "disabled";
};

export interface NextradeReadiness {
  venue: "NEXTRADE";
  mode: NextradeMode;
  status: "paper_only" | "blocked" | "adapter_pending";
  configured: boolean;
  orderEntry: "not_connected";
  marketData: "not_connected";
  missing: string[];
  nextSteps: string[];
}

/**
 * Reads only configuration presence. Secret values are never returned.
 *
 * The real NEXTRADE participant/broker protocol is intentionally not guessed
 * here. Once the participant's official sandbox specification is supplied,
 * the transport implementation can sit behind this readiness boundary.
 */
export function getNextradeReadiness(env: RuntimeEnv = runtimeEnv()): NextradeReadiness {
  const mode = readMode(env.NEXTRADE_MODE);
  const missing = mode === "disabled"
    ? []
    : NEXTRADE_REQUIRED_ENV.filter((key) => !env[key]?.trim());

  return {
    venue: "NEXTRADE",
    mode,
    status: mode === "disabled" ? "paper_only" : missing.length ? "blocked" : "adapter_pending",
    configured: mode !== "disabled" && missing.length === 0,
    orderEntry: "not_connected",
    marketData: "not_connected",
    missing: [...missing],
    nextSteps: mode === "disabled"
      ? ["NEXTRADE 참가 증권사 접속 사양과 sandbox 인증정보를 등록하세요."]
      : missing.length
        ? ["누락된 NEXTRADE 환경변수를 등록하세요."]
        : ["공식 sandbox 주문·시세 프로토콜 어댑터와 conformance test를 연결하세요."],
  };
}

