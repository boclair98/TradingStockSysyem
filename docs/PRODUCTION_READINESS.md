# Production readiness boundary

TradingStockSysyem is an institutional ATS certification environment. It implements the same
logical boundary as an exchange venue: member order entry, validation and sequencing, pre-trade
risk, deterministic matching, market-data publication, execution reporting and drop copy.

It is not an authorized exchange and must not be presented as a live securities market. The
public deployment is for conformance testing and demonstrations; it has no clearing, settlement or
legal trade effect.

## Implemented

- Price/time priority CLOB matching with IOC, FOK, midpoint, stop-limit and call auction support
- Member/session scoped order-entry gateway with HMAC authentication and strict inbound sequence
- Duplicate client-order detection, clock-skew validation and distributed message-rate limiting
- Deterministic market sequence, execution reports, market-data snapshots and drop-copy journal
- Korean tick sizes, daily price bands, instrument admission and venue-wide halt modes
- Pre-trade quantity/notional/open-order limits and self-trade prevention
- Durable order/execution/audit journals, restart recovery and SHA-256 audit-chain verification
- Process serialization plus PostgreSQL advisory transaction fencing for multi-instance mutations
- Operator states `OPEN`, `CANCEL_ONLY` and `FULL_STOP`, health/readiness and live operations view

## Required before regulated production

1. NEXTRADE/participant-approved protocol specifications, conformance scenarios, CompIDs, PKI/mTLS
   certificates, IP allowlists and dedicated connectivity.
2. Licensed reference/market-data feeds for instrument master, corporate actions, trading status,
   price bands and KRX/NEXTRADE market state.
3. Clearing and settlement interfaces and operating agreements with the relevant clearing,
   depository and participant institutions, including reconciliation and fails handling.
4. Independent active/standby sequencers, consensus/fencing, deterministic replay, tested regional
   disaster recovery and formally approved RTO/RPO.
5. PTP-class time synchronization, immutable external audit retention, HSM-backed keys, SIEM,
   DDoS/WAF controls, penetration testing and access recertification.
6. Market surveillance, short-sale and price-manipulation controls, regulatory reporting, legal
   approval and operational staffing/runbooks.
7. Capacity certification for forecast peak message rates, tail latency, soak, failover and recovery.

## Member onboarding inputs

- Member ID/CompID and enabled sessions
- Certification and production endpoint allocation
- Public certificates and certificate chain (private keys remain with their owner)
- Source IPs and network/circuit details
- Protocol version, order types, throttles and kill-switch contacts
- Drop-copy and market-data session requirements

Retail broker credentials such as Toss Securities or Korea Investment app keys are intentionally
outside the ATS core. A broker member connects its own OMS/gateway to the venue interface; each
investor does not upload a personal brokerage credential to the exchange.
