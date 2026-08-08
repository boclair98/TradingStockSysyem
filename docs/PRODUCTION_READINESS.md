# Production readiness boundary

TradingStockSysyem is an authenticated, persistent multi-user paper venue. It is suitable for
matching-rule demonstrations, integration development and controlled load/recovery exercises. It is
not yet an authorized exchange, broker OMS or real-money execution venue.

## Implemented in this repository

- Deterministic price/time priority matching, call auction, IOC/FOK, midpoint and stop-limit orders
- Korean tick sizes, daily price band and NEXTRADE session profiles
- Participant cash/inventory checks, order limits and self-trade prevention
- Durable user, account, position, order, execution and audit journals
- Exact open-order recovery without re-matching recovered orders
- Serialized order mutations, mandatory idempotency keys and per-user mutation throttling
- Authenticated ownership checks and isolated participant ledgers
- Operator-only `OPEN`, `CANCEL_ONLY` and `FULL_STOP` venue control
- Optimistic venue-control versioning, SSE market events and health/readiness endpoints
- SHA-256 chained user audit records with online integrity verification

## Required before any real-money or institutional production use

1. Licensed broker or exchange connectivity: official sandbox/production REST, WebSocket or FIX
   specifications, credentials, account identifiers, certificates and source-IP registration.
2. Independent market-data entitlement and normalization for KRX/NEXTRADE best quotes, trades,
   reference prices, corporate actions and instrument status.
3. Active/standby or active/active sequencer design, consensus/fencing, deterministic replay and a
   separately tested disaster-recovery region. The current deployment uses one in-process sequencer.
4. Clearing and settlement integration, reconciliation, fails management and the applicable T+2
   workflow. The current cash and positions are simulated.
5. Exchange-grade time synchronization, immutable external audit retention, HSM-backed keys, SIEM,
   DDoS/WAF controls, penetration testing and formal access recertification.
6. Market-surveillance rules, regulatory reporting, short-sale controls, investor protection and
   legal/compliance approval under the applicable Korean rules.
7. Capacity certification with realistic peak-order bursts, latency percentiles, soak/failover tests
   and published recovery objectives.

## External connection package to request later

- Provider and environment (`sandbox` or `production`)
- REST base URL and WebSocket/FIX endpoint
- App key/client id and secret, supplied only through hosted secrets
- Account identifier and product/account type
- Venue-selection support (`AUTO`, `KRX`, `NEXTRADE`)
- Authentication/token, order, cancel/replace, balance, quote and execution-notice specifications
- Rate limits, maintenance windows, certificate requirements and test-account approval

