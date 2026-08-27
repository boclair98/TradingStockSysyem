# Trading Stock System

> 주문을 정확히 체결하고, 안전하게 중계하고, 끝까지 추적할 수 있는 자동 매매체결 시스템

[![CI](https://github.com/boclair98/TradingStockSysyem/actions/workflows/ci.yml/badge.svg)](https://github.com/boclair98/TradingStockSysyem/actions/workflows/ci.yml)

저장소와 기존 서비스 URL의 호환성을 위해 프로젝트 slug는 `TradingStockSysyem`을 유지합니다.

[가상 주문 데모 · 실주문 차단](https://tradingstocksysyem.coders.kr/) · [제품 아키텍처](docs/EXCHANGE_ARCHITECTURE.md) · [운영 준비도](docs/PRODUCTION_READINESS.md) · [성능 기준선](docs/PERFORMANCE_BASELINE.md) · [보안 정책](SECURITY.md)

![Trading Stock System 시스템 개요](public/og.png)

> [!IMPORTANT]
> 이 저장소는 **Engineering Evaluation Build**입니다. 공개 데모는 가상 주문 검증 환경이며 외부 주문 전송이 차단되어 있습니다. 3개 증권사의 주문 변환 어댑터와 고정 응답 기반 계약 테스트는 구현했지만, 증권사 운영 승인과 샌드박스·운영 E2E 검증은 완료되지 않았습니다. 자동 전략 실행 워커와 거래소 운영에 필요한 인가·전용망·청산결제·시장감시·고가용성 체계도 아직 완성되지 않았습니다.

## 목차

- [프로젝트 소개](#프로젝트-소개)
- [프로젝트 목표](#프로젝트-목표)
- [현재 구현 상태](#현재-구현-상태)
- [시스템 구조](#시스템-구조)
- [핵심 기능](#핵심-기능)
- [사용자 경험](#사용자-경험)
- [주요 기술적 선택](#주요-기술적-선택)
- [증권사 연결](#증권사-연결)
- [기술 스택](#기술-스택)
- [시작하기](#시작하기)
- [테스트와 성능](#테스트와-성능)
- [주요 API](#주요-api)
- [실거래 전 확인사항](#실거래-전-확인사항)
- [로드맵](#로드맵)

## 프로젝트 소개

매매체결 시스템은 단순히 매수·매도 버튼을 제공하는 화면이 아닙니다. 같은 가격에서는 먼저 들어온 주문을 우선해야 하고, 중복이나 한도 초과 주문은 상태를 바꾸기 전에 거절해야 하며, 장애 후에도 같은 명령을 같은 순서로 재생해 동일한 주문장을 복원할 수 있어야 합니다. 외부 증권사에 주문을 보낸 뒤 응답이 끊겼다면 성공이나 실패로 임의 판정하지 않고 실제 상태를 다시 대사해야 합니다.

Trading Stock System은 이 문제를 다음 두 경로로 분리해 검증합니다.

1. **Venue Matching Lab**: 주문 접수, 회원 검증, 가격·시간 우선 체결, 위험 통제, 원장과 감사 추적을 시험합니다.
2. **Live Broker Routing**: 사용자별 증권사 연결, 주문 미리보기, 위험 한도, 킬 스위치, 주문 전송과 체결 대사를 담당합니다.

두 경로는 책임과 장애 범위가 다르므로 분리되어 있습니다. 브로커 주문 어댑터는 거래소 매칭 코어를 대체하지 않으며, 독립 Java 코어는 현재 웹 애플리케이션의 실주문 경로에 직접 연결되어 있지 않습니다.

## 프로젝트 목표

- **정확성**: 부동소수점 대신 정수 가격·수량과 단조 증가 sequence를 사용합니다.
- **결정성**: 동일 명령을 동일 순서로 재생하면 동일한 주문장과 상태 다이제스트를 얻습니다.
- **안전성**: 중복 주문, 자기체결, 속도 초과, 위험 한도 초과를 체결 전에 차단합니다.
- **복구 가능성**: 명령 WAL과 감사 원장으로 재기동·대사·사후 분석이 가능해야 합니다.
- **외부 장애 격리**: 증권사 타임아웃을 임의의 실패로 바꾸지 않고 `UNKNOWN` 상태로 보존한 뒤 대사합니다.
- **다중 사용자 격리**: 사용자마다 증권사 자격증명, 계좌, 위험 정책과 주문 이력을 분리합니다.
- **확장성**: 증권사별 차이를 어댑터 경계 안에 두고 공통 주문 서비스와 분리합니다.

## 현재 구현 상태

| 영역 | 상태 | 현재 범위 |
|---|---|---|
| Java 21 매칭 코어 | 구현 | 가격·시간 우선 CLOB, 신규·취소·정정, DAY/IOC/FOK, STP, 위험 게이트, WAL·재생 |
| TypeScript 참조 엔진 | 구현 | 웹 시연과 규칙 검증용 매칭, 시장 단계·경매·midpoint·stop-limit 시험 |
| 회원사 주문 게이트웨이 | 시험 구현 | HMAC, 연속 sequence, 중복 방지, 속도 제한, Execution Report, Drop Copy |
| 주문·체결·감사 원장 | 구현 | PostgreSQL/D1 저장, 감사 해시체인, 운영 상태, 사용자별 주문 기록 |
| 증권사 주문 API 경로 | 코드·모킹 테스트 구현, 운영 미승인 | 토스증권·한국투자증권·키움증권 계좌/최신 시세/현금 주문/취소/대사 어댑터 |
| 자동 전략 실행 | 미구현 | 전략·실행 이력 스키마는 있으나 상시 scheduler/runner와 자동화 API는 없음 |
| 운영 거래소 인프라 | 미구현·외부 의존 | 승인 프로토콜, 전용망/mTLS, 청산결제, 시장감시, 이중센터, 규제 인증 |

## 시스템 구조

```mermaid
flowchart LR
    subgraph LAB[Venue Matching Lab]
        MC[회원사 시험 클라이언트] --> GW[Member Gateway]
        GW --> REF[TypeScript Reference Engine]
        REF --> LEDGER[(주문·체결·감사 원장)]
        REF --> MD[호가·체결 이벤트]
        GW --> DROP[Execution Report / Drop Copy]

        CORE[Java 21 Deterministic Core] --> WAL[(CRC32C + fsync WAL)]
        WAL --> REPLAY[Replay + State Digest]
    end

    subgraph LIVE[Live Broker Routing]
        USER[로그인 사용자] --> API[Live Trading API]
        API --> SAFE[동의·한도·Kill Switch·60초 Preview]
        SAFE --> ROUTER[Broker Router]
        ROUTER --> TOSS[토스증권]
        ROUTER --> KIS[한국투자증권]
        ROUTER --> KIWOOM[키움증권]
        ROUTER --> JOURNAL[(Idempotency Journal)]
        JOURNAL --> RECON[체결 대사]
    end

    GW -. 규칙·프로토콜 검증 .-> CORE
```

### 주문 처리 흐름

**매칭 경로**

1. 회원 세션, 서명, 시간 편차와 inbound sequence를 검증합니다.
2. 중복 `ClientOrderId`, 주문 속도, 종목·호가단위·가격범위와 위험 한도를 확인합니다.
3. 명령을 WAL에 기록한 뒤 종목별 가격·시간 우선 주문장에 반영합니다.
4. 주문·체결 이벤트에 전역 sequence를 부여하고 Execution Report와 Drop Copy를 생성합니다.
5. 재기동 시 명령을 재생하고 SHA-256 상태 다이제스트로 결과를 비교합니다.

**증권사 실주문 경로**

1. 로그인 사용자에게 연결된 증권사 계좌와 위험 정책을 불러옵니다.
2. 사용자 동의, 킬 스위치, 주문 한도와 허용 종목을 검사합니다.
3. 주문 내용을 미리보기로 고정하고 60초 동안 한 번만 사용할 수 있는 확인 절차를 발급합니다.
4. 동일 요청의 중복 전송을 막은 뒤 선택한 증권사 어댑터로 주문을 보냅니다.
5. 네트워크 오류로 결과를 확정할 수 없으면 `UNKNOWN`으로 기록하고 증권사 원장과 대사합니다.

## 핵심 기능

### 결정론적 매칭 코어

- 정수 기반 가격·수량과 종목별 가격·시간 우선 CLOB
- 지정가·보호가격 시장가, DAY·IOC·FOK
- 신규·취소·정정과 정정 시 시간 우선순위 상실
- 회원별 중복 `ClientOrderId` 차단
- 공격 주문 취소 방식의 자기체결 방지(STP)
- 호가단위·수량단위·일일 가격범위 검증
- 주문수량·주문금액·미체결 한도와 회원별 킬 스위치
- 단조 증가 명령/이벤트 sequence
- CRC32C 프레임, `fsync` 명령 WAL, 부분 프레임·sequence gap 거부
- 명령 재생과 SHA-256 상태 다이제스트 비교

### 회원사 게이트웨이와 운영 통제

- 회원/세션별 HMAC 인증 시험
- 연속 inbound/outbound sequence와 clock-skew 검사
- 세션별 속도 제한과 중복 주문 방지
- Execution Report, Drop Copy, 시장정보 snapshot과 market sequence
- 정상·취소전용·전면정지 시장 상태
- PostgreSQL advisory lock 기반 변경 직렬화 시험
- 주문·체결·운영 이벤트 감사 원장과 해시체인

### 다중 사용자 브로커 라우팅

- 로그인 사용자별 계좌·주문·위험 정책 격리
- 자격증명과 접근 토큰의 AES-256-GCM 암호화
- 계좌번호 마스킹과 사용자별 요청 burst guard
- 주문 미리보기, 일회성 확인, idempotency journal
- 주문 전송 직전 최신 시세·잔고·위험한도 재검증과 preview 기반 중복 재시도 복구
- 현금 주문 한도, 종목 allow-list, 사용자 킬 스위치
- 타임아웃·네트워크 단절 시 불확실 상태 보존과 체결 대사

## 사용자 경험

화면은 작업 목적에 따라 네 개의 공간으로 분리되어 있습니다.

| 작업공간 | 대상 | 주요 작업 |
|---|---|---|
| 실거래 주문 | 일반 사용자 | 증권계좌 연결, 잔고 조회, 위험한도, 주문 미리보기, 주문·취소·대사 |
| 매칭엔진 검증 | 개발·QA | 가상 주문, 호가장, 경매, 체결 이벤트, 주문 원장 |
| 운영 모니터 | 운영자 | 저장소·이벤트 스트림·시장 상태·회원사 세션 확인 |
| 시스템 아키텍처 | 기술 검토자 | 구현 범위, 성능 기준선, 운영 전환 격차 확인 |

- 실거래와 가상 매칭 랩을 시각적·정보 구조상 분리해 mode error를 줄였습니다.
- 상단 상태는 하드코딩 문구가 아니라 readiness, 영속 저장소와 이벤트 스트림에서 계산합니다.
- 실주문 미리보기는 계좌·종목·매수/매도·주문 조건·수량·가격·라우팅·시세 시각과 남은 시간을 함께 표시합니다.
- 위험 작업은 영향 범위를 보여주는 키보드 접근 가능한 확인 대화상자를 사용합니다.
- 모바일에서는 네 개의 핵심 작업공간을 하단 내비게이션으로 제공합니다.

## 주요 기술적 선택

| 문제 | 선택 | 이유 |
|---|---|---|
| 금액 계산 오차 | 정수 가격·수량 | 부동소수점 반올림이 주문 우선순위와 위험 한도에 영향을 주지 않게 합니다. |
| 동일 시각 주문의 순서 | 단조 증가 sequence | wall-clock 동률이나 시간 역행과 무관한 전체 순서를 만듭니다. |
| 장애 후 상태 복원 | WAL 선기록 후 상태 변경 | 승인된 명령만 순서대로 재생하고 손상·누락을 즉시 감지합니다. |
| 외부 주문 타임아웃 | `UNKNOWN` + reconciliation | 재시도로 같은 주문이 두 번 나가는 문제를 막습니다. |
| 사용자별 API 키 보관 | owner/record AAD를 포함한 AES-GCM | 다른 사용자나 레코드로 암호문이 바뀌어 사용되는 것을 방지합니다. |
| 다중 인스턴스 상태 변경 | DB advisory lock + idempotency key | 프로세스 내부 lock만으로 막을 수 없는 동시 변경을 직렬화합니다. |
| 매칭과 브로커 주문의 결합 | 독립 경계와 어댑터 | 체결 규칙의 결정성과 외부 API의 지연·장애를 분리합니다. |

구현과 검증 근거는 [Java 매칭 코어](venue-core-java/src/main/java/kr/tradingstocksysyem/venue/MatchingKernel.java), [내구성 저널](venue-core-java/src/main/java/kr/tradingstocksysyem/venue/DurableJournal.java), [실주문 안전 서비스](engine/liveTradingService.ts), [분산 직렬화](engine/distributedLock.ts), [테스트 모음](tests/)에서 확인할 수 있습니다.

## 증권사 연결

| 증권사 | 실전 환경 | 모의 환경 | 현재 라우팅 범위 | 비고 |
|---|---:|---:|---|---|
| 토스증권 | 지원 코드 | 미지원 | SOR / DAY | Client ID·Secret, 계좌 자동조회 |
| 한국투자증권 | 지원 코드 | 지원 코드 | KRX·NXT·SOR | App Key·Secret, 계좌번호 |
| 키움증권 | 지원 코드 | 지원 코드 | 실전 KRX·NXT·SOR, 모의 KRX | App Key·Secret, 계좌 자동조회 |

여기서 “지원 코드”는 어댑터와 API 경로가 구현되었다는 뜻이며, 현재 공개 서버에서 실주문이 승인되었다는 뜻은 아닙니다. 실제 연결에는 사용자별 증권사 API 사용 승인, 등록된 고정 출발 IP, 운영 자격증명과 각 증권사의 최신 약관·주문 규격 확인이 필요합니다. 자세한 내용은 [증권사 지원 및 연결 매트릭스](docs/BROKER_SUPPORT_MATRIX_KO.md)를 확인하세요.

## 기술 스택

| 구분 | 기술 |
|---|---|
| Web | Next.js 16.2.6, React 19.2.6, TypeScript 5.9.3 |
| Runtime / Build | Node.js 22.13+, Vinext, Vite, Cloudflare Worker entry |
| Matching Core | Java 21 |
| Data | PostgreSQL, Cloudflare D1 adapter, Drizzle ORM 0.45.2 |
| Test | Node test runner, TSX, Java test harness, rendered HTML test |
| Deployment | Docker, Coders public web service |

### 디렉터리 구조

```text
.
├─ app/                    # 운영 UI와 HTTP/SSE API
│  └─ api/                # 주문, 게이트웨이, 시장정보, 실계좌 API
├─ engine/                 # 매칭, 회원 게이트, 위험, 브로커 어댑터
├─ db/                     # Drizzle 스키마, 원장, 감사·실거래 저장 계층
├─ drizzle/                # 데이터베이스 migration
├─ venue-core-java/        # 독립 Java 21 결정론적 매칭 코어
├─ tests/                  # TypeScript 단위·계약·렌더 테스트
├─ docs/                   # 아키텍처, 운영 준비도, 장애복구, 성능 문서
├─ worker/                 # 웹 런타임 엔트리(자동 전략 워커가 아님)
├─ Dockerfile
└─ coders.yaml
```

## 시작하기

### 요구사항

- Node.js 22.13 이상
- npm
- PostgreSQL 또는 Cloudflare D1 binding
- Java 코어를 실행하려면 JDK 21

### 웹 애플리케이션

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

로컬 PostgreSQL을 사용할 때 `.env.local`에 다음 값을 추가합니다.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/trading_stock_system

# 개발 중에는 실주문 게이트를 잠근 상태로 유지합니다.
LIVE_TRADING_ENABLED=false
TRADING_ENVIRONMENT=member_certification
LIVE_MARKET_ENABLED=false
LIVE_TRADING_EGRESS_READY=false

# 운영자 계정은 자동 생성되지 않습니다. 인증 제공자의 user ID를 명시합니다.
OPERATOR_USER_IDS=
```

브라우저에서 <http://localhost:3000>을 엽니다. 실제 비밀키는 저장소에 커밋하지 말고 배포 환경의 Secret 저장소에만 등록하세요.

### Java 매칭 코어

```powershell
powershell -ExecutionPolicy Bypass -File venue-core-java/scripts/test.ps1
powershell -ExecutionPolicy Bypass -File venue-core-java/scripts/benchmark.ps1
```

세부 사용법은 [Java Venue Core README](venue-core-java/README.md)에 정리되어 있습니다.

## 테스트와 성능

```powershell
npm test
npx tsc --noEmit
npm run lint
powershell -ExecutionPolicy Bypass -File venue-core-java/scripts/test.ps1
```

- 2026-08-27 기준 TypeScript 단위 테스트: **30/30 통과**
- 서버 렌더링 회귀 테스트: **2/2 통과**
- Java 결정론적 매칭 코어 테스트: **8/8 통과**
- TypeScript 타입 검사, ESLint, 프로덕션 빌드: **통과**
- 테스트와 CI는 실제 증권사 주문 endpoint를 호출하지 않습니다.
- 브로커 테스트는 고정 응답을 사용해 인증, 요청 변환, 오류와 불확실 상태 처리를 검증합니다.

### Java 코어 성능 기준선

| 항목 | 값 |
|---|---:|
| Runtime | Java 21, 512 MiB heap |
| 데이터 구성 | 100개 회원, 단일 종목 |
| Workload | 비체결 DAY 지정가 명령 100,000건 |
| 처리량 | 약 **144,902 commands/s** |

이 수치는 2026-08-09 개발 PC에서 측정한 로컬 기준선입니다. 네트워크, 동기 복제, 시장정보 fan-out, GC tail, NUMA, 장애전환을 포함하지 않으므로 거래소 SLA가 아닙니다. 재현 조건과 한계는 [성능 기준선 문서](docs/PERFORMANCE_BASELINE.md)를 참고하세요.

## 주요 API

| Method | Endpoint | 역할 |
|---|---|---|
| `GET` | `/api/health` | 프로세스 상태 확인 |
| `GET` | `/api/readiness` | DB·게이트웨이·운영 준비도 확인 |
| `GET` | `/api/instruments` | 종목 마스터 조회 |
| `GET/POST` | `/api/orders` | 시험 주문 조회·접수 |
| `DELETE/POST` | `/api/orders/{orderId}` | 주문 취소·정정 |
| `POST` | `/api/gateway/order-entry` | 서명·sequence가 포함된 회원 주문 접수 |
| `GET` | `/api/market-data/snapshot` | 호가·시장 sequence snapshot |
| `GET` | `/api/live/readiness` | 실주문 서버 게이트와 사용자 준비도 확인 |
| `GET` | `/api/live/account` | 연결 계좌와 잔고 조회 |
| `GET` | `/api/live/quote` | 증권사 시세 조회 |
| `POST` | `/api/live/orders/preview` | 60초 일회성 실주문 미리보기 생성 |
| `GET/POST` | `/api/live/orders` | 실주문 이력 조회·전송 |
| `POST` | `/api/live/reconcile` | 불확실 주문과 증권사 원장 대사 |

`/api/live/*` 경로가 존재해도 모든 서버·사용자 안전 게이트가 통과하지 않으면 외부 주문은 전송되지 않습니다.

## 실거래 전 확인사항

공개 데모의 환경변수 기본값은 `member_certification`과 `LIVE_MARKET_ENABLED=false`입니다. 아래 항목을 모두 충족하고 별도의 샌드박스·소액 검증을 마치기 전에는 실주문 게이트를 열면 안 됩니다.

- 증권사별 정식 API 사용 승인과 사용자 약관·위험 고지
- 증권사에 등록된 고정 출발 IP와 TLS/비밀키 운영 절차
- 사용자별 강한 인증, 권한 분리, 자격증명 교체·폐기 절차
- 주문·일·종목별 한도와 기본 활성 킬 스위치
- 중복·타임아웃·부분 체결·장 마감·정정/취소 경합 대사 시험
- 감사로그, 지표, 경보, 온콜, 장애복구와 비상 중지 runbook
- 개인정보·전자금융·금융투자 관련 법률 및 계약에 대한 전문 검토

거래소 또는 다자간매매체결회사 운영을 목표로 한다면 브로커 API만으로는 부족합니다. 회원사 승인 프로토콜, 라이선스 시장데이터, 시장감시·규제보고, 청산·결제, 전용망·PKI/HSM, 이중센터와 성능·장애복구 인증이 별도로 필요합니다. 현재 차이는 [거래소 납품 준비 갭 매트릭스](docs/EXCHANGE_PRODUCT_GAP_MATRIX.md)에 기록했습니다.

## 로드맵

- [ ] 자동 전략 scheduler/runner와 durable queue 구현
- [ ] 전략별 idempotency, 재시작 복구, 주문 예산과 실행 중지 정책
- [ ] 증권사 실시간 WebSocket 시세와 표준 market-data event 모델
- [ ] 모의투자 환경에서 주문·취소·부분체결·대사 E2E 시험
- [ ] 어댑터 contract test와 증권사 추가를 위한 plugin 경계 정리
- [ ] queue/backpressure, p99/p99.9 지연, trace·metric·alert 관측성
- [ ] active/standby, WAL 복제, 장애전환과 RTO/RPO 검증
- [ ] 회원사 적합성, 시장감시, 규제보고, 청산결제 인터페이스

## 관련 문서

- [거래소 납품 준비 갭 매트릭스](docs/EXCHANGE_PRODUCT_GAP_MATRIX.md)
- [목표 제품 아키텍처](docs/EXCHANGE_ARCHITECTURE.md)
- [장애전환·복구 Runbook](docs/FAILOVER_RUNBOOK.md)
- [성능 기준선](docs/PERFORMANCE_BASELINE.md)
- [운영 전환 경계](docs/PRODUCTION_READINESS.md)
- [실거래 브로커 출시 체크리스트](docs/LIVE_BROKER_RELEASE_KO.md)
- [증권사 지원 및 연결 매트릭스](docs/BROKER_SUPPORT_MATRIX_KO.md)
