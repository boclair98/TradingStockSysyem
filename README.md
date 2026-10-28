# Trading Stock System

> 자동주문 규칙을 안전하게 설계·검증하고, 주문을 정확히 체결·중계·추적하기 위한 매매체결 플랫폼

[![CI](https://github.com/boclair98/TradingStockSysyem/actions/workflows/ci.yml/badge.svg)](https://github.com/boclair98/TradingStockSysyem/actions/workflows/ci.yml)

저장소와 기존 서비스 URL의 호환성을 위해 프로젝트 slug는 `TradingStockSysyem`을 유지합니다.

[공개 서비스 · 가상매매 베타](https://tradingstocksysyem.coders.kr/) · [가상 운용과 API 준비](docs/PAPER_OPERATIONS_KO.md) · [제품 전략](docs/PRODUCT_STRATEGY.md) · [제품 아키텍처](docs/EXCHANGE_ARCHITECTURE.md) · [운영 준비도](docs/PRODUCTION_READINESS.md) · [보안 정책](SECURITY.md)

| 서비스 | 상태 | 검증일 |
|---|---|---|
| `tradingstocksysyem.coders.kr` | `ready` · 가상매매 베타, 운영 PostgreSQL 흐름 확인 | 2026-10-28 |
| 가상 운용 | 구현 · 사용자별 원장·가격 기록 재생 | 2026-10-28 |
| 증권사 실주문 | 서버·사용자 게이트 잠금 | 2026-10-28 |

![Trading Stock System 시스템 개요](public/og.png)

> [!IMPORTANT]
> 이 저장소는 **가격 기록 재생 기반 가상매매 베타 / Engineering Evaluation Build**입니다. 사용자별 가상 현금·보유종목·주문·부분체결·수수료를 서버에 저장합니다. 가격 출처는 사용자가 입력한 `USER_REPLAY`이며, 실제 시세나 실제 체결이 아닙니다. 지속 실시간 feed와 상시 실행기는 아직 연결하지 않았습니다. 3개 증권사의 주문 변환 어댑터와 고정 응답 기반 계약 테스트는 구현했지만 운영 승인과 실제 샌드박스·운영 E2E 검증은 미완료이며 실주문 release gate는 잠겨 있습니다.

## 가상매매 시작하기

로그인 → 전략 설계에서 조건 저장 → 가상 운용에서 전략 선택 → **가상 운용 시작** → **연습 기록 만들기** 또는 권한이 있는 가격 기록 입력 → **가격 기록 재생** → 잔고·주문 원장·CSV 확인. 증권사 API나 계좌번호 없이 사용할 수 있습니다. 처음에는 가상 현금 1억원, 보유주식 0주이며 공동 매칭 LAB 계좌와 분리됩니다. 상세 체결 모델·API 발급 경로·저장 위치는 [가상 운용 안내](docs/PAPER_OPERATIONS_KO.md)를 참고하세요.

## 목차

- [프로젝트 소개](#프로젝트-소개)
- [프로젝트 목표](#프로젝트-목표)
- [제품 가치 흐름](#제품-가치-흐름)
- [현재 구현 상태](#현재-구현-상태)
- [시스템 구조](#시스템-구조)
- [핵심 기능](#핵심-기능)
- [사용자 경험](#사용자-경험)
- [주요 기술적 선택](#주요-기술적-선택)
- [증권사 연결](#증권사-연결)
- [기술 스택](#기술-스택)
- [시작하기](#시작하기)
- [환경변수](#환경변수)
- [데이터베이스](#데이터베이스)
- [테스트와 성능](#테스트와-성능)
- [주요 API](#주요-api)
- [실거래 전 확인사항](#실거래-전-확인사항)
- [로드맵](#로드맵)
- [배포와 저장소 운영](#배포와-저장소-운영)
- [반응형 검증](#반응형-검증)
- [보안과 사용 조건](#보안과-사용-조건)

## 프로젝트 소개

매매체결 시스템은 단순히 매수·매도 버튼을 제공하는 화면이 아닙니다. 같은 가격에서는 먼저 들어온 주문을 우선해야 하고, 중복이나 한도 초과 주문은 상태를 바꾸기 전에 거절해야 하며, 장애 후에도 같은 명령을 같은 순서로 재생해 동일한 주문장을 복원할 수 있어야 합니다. 외부 증권사에 주문을 보낸 뒤 응답이 끊겼다면 성공이나 실패로 임의 판정하지 않고 실제 상태를 다시 대사해야 합니다.

Trading Stock System은 이 문제를 다음 세 경로로 분리해 검증합니다.

1. **Automation Readiness Lab**: 가격 조건 전략을 Paper 초안으로 만들고, 조건 충족·대기 두 시나리오와 예산 한도를 검증합니다.
2. **Venue Matching Lab**: 주문 접수, 회원 검증, 가격·시간 우선 체결, 위험 통제, 원장과 감사 추적을 시험합니다.
3. **Live Broker Routing**: 사용자별 증권사 연결, 주문 미리보기, 위험 한도, 킬 스위치, 주문 전송과 체결 대사를 담당합니다.

세 경로는 책임과 장애 범위가 다르므로 분리되어 있습니다. 브로커 주문 어댑터는 거래소 매칭 코어를 대체하지 않으며, 독립 Java 코어는 현재 웹 애플리케이션의 실주문 경로에 직접 연결되어 있지 않습니다.

## 프로젝트 목표

- **정확성**: 부동소수점 대신 정수 가격·수량과 단조 증가 sequence를 사용합니다.
- **결정성**: 동일 명령을 동일 순서로 재생하면 동일한 주문장과 상태 다이제스트를 얻습니다.
- **안전성**: 중복 주문, 자기체결, 속도 초과, 위험 한도 초과를 체결 전에 차단합니다.
- **복구 가능성**: 명령 WAL과 감사 원장으로 재기동·대사·사후 분석이 가능해야 합니다.
- **외부 장애 격리**: 증권사 타임아웃을 임의의 실패로 바꾸지 않고 `UNKNOWN` 상태로 보존한 뒤 대사합니다.
- **다중 사용자 격리**: 사용자마다 증권사 자격증명, 계좌, 위험 정책과 주문 이력을 분리합니다.
- **확장성**: 증권사별 차이를 어댑터 경계 안에 두고 공통 주문 서비스와 분리합니다.

## 제품 가치 흐름

첫 목표는 결제가 아니라 사용자가 “아이디어를 안전한 규칙으로 바꾸고 오류를 발견하는” 경험을 반복하게 만드는 것입니다.

1. 종목·가격 조건·매수/매도·수량을 정합니다.
2. 1회 예상 주문금액과 일일 예산을 확인하고 초안으로 저장합니다.
3. 사용자가 직접 입력한 가격으로 조건 충족 상황을 한 번 점검합니다.
4. 반대 가격으로 조건 대기 상황도 점검합니다.
5. 현재 설정 해시에 두 이력이 모두 있으면 검증 완료로 표시합니다.
6. 설정을 바꾸면 초안으로 돌아가 다시 검증합니다.

외부 API 없이도 이 흐름과 사용자별 격리 Paper Broker를 사용할 수 있습니다. 저장한 전략을 복사해 가격 기록을 순서대로 재생하면 가상 원장이 갱신됩니다. 다음 단계는 라이선스 시세와 내구성 실행 워커이며, 운영 승인을 받은 뒤에 실거래 자동화로 전환합니다. 상세 원칙과 수익화 가설은 [제품 전략](docs/PRODUCT_STRATEGY.md)에 정리했습니다.

## 현재 구현 상태

| 영역 | 상태 | 현재 범위 |
|---|---|---|
| Java 21 매칭 코어 | 구현 | 가격·시간 우선 CLOB, 신규·취소·정정, DAY/IOC/FOK, STP, 위험 게이트, WAL·재생 |
| TypeScript 참조 엔진 | 시험 구현·기본 잠금 | PostgreSQL·승인 single-writer가 있을 때만 공동 LAB 쓰기; 사용자별 격리 가상 운용은 별도 제공 |
| 회원사 주문 게이트웨이 | 시험 구현 | HMAC, 연속 sequence, 중복 방지, 속도 제한, Execution Report, Drop Copy |
| 주문·체결·감사 원장 | 구현 | PostgreSQL/D1 저장, 감사 해시체인, 운영 상태, 사용자별 주문 기록 |
| 증권사 주문 API 경로 | 코드·모킹 테스트 구현, 운영 미승인 | 토스증권·한국투자증권·키움증권 계좌/최신 시세/현금 주문/취소/대사 어댑터 |
| 자동화 준비실 | 구현 | `PRICE_CROSS` 초안·수정, 서버 검증, 설정 해시, 수동 1회 Paper 판정, 정확한 누적 진행률, 결정 이력 |
| 격리 가상 운용 | 구현 | 사용자별 가상 현금·보유종목, 가격 기록 1~50틱 재생, 부분체결, 미체결 예약·취소, 가정 수수료·실현손익, 원장 CSV, CAS·중복 명령 원자성 |
| 상시 자동 전략 실행 | 미구현·잠금 | 사용자별 Paper Broker, 라이선스 시세, durable scheduler/queue/outbox, 별도 동의가 필요 |
| 운영 거래소 인프라 | 미구현·외부 의존 | 승인 프로토콜, 전용망/mTLS, 청산결제, 시장감시, 이중센터, 규제 인증 |

## 시스템 구조

```mermaid
flowchart LR
    subgraph AUTO[Automation Readiness Lab]
        IDEA[가격 조건 전략] --> VALIDATE[종목·호가·수량·예산 검증]
        VALIDATE --> SCENARIO[사용자 가격 1회 판정]
        SCENARIO --> HISTORY[(설정 해시·결정 이력)]
        HISTORY --> READY[양쪽 시나리오 준비도]
    end

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

    READY -. 미래: 격리 Paper Broker .-> SAFE
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

**자동화 준비 경로**

1. 클라이언트 입력을 서버에서 다시 검증하고 상태를 항상 `draft`, 실행 모드를 항상 `paper`로 저장합니다.
2. 사용자가 입력한 가정 가격을 `USER_SCENARIO` 출처로 명시합니다.
3. `LTE`/`GTE` 경계값, 예상 주문금액과 일일 예산을 판정합니다.
4. `WOULD_SUBMIT`, `CONDITION_WAITING`, `RISK_BLOCKED` 중 하나와 주문 미전송 사실을 기록합니다.
5. 현재 설정 해시에 조건 충족·대기 이력이 모두 있어야 검증 완료로 표시합니다.

## 핵심 기능

### 사용자별 가상 운용

- `GET/POST /api/paper`: 계좌/최근 명령 조회, 시작·중지·취소·가격 기록 재생
- 실계좌 및 공동 매칭 LAB과 별도 계좌. 매수는 가상 현금을 차감하고 매도는 보유한 가상 주식만 허용
- 사용자·명령 키 복합 PK와 계좌 version CAS; 원장 변경과 명령 기록을 같은 DB transaction에 반영
- 역순·중복 시각, 잘못된 호가·수량을 전체 batch 반영 전에 거부
- 틱별 유동성, 부분체결, 지정가 대기, 시장가 잔량 취소, KST 세션 일일 주문/금액 제한
- 가정 수수료 각 0.015%, 실현손익/평가액. 세금·시장충격·대기열은 미반영
- 최근 종료 주문 100건과 모든 미체결을 화면/CSV로 제공. 전체 명령 이벤트는 서버 보존
- 지속 실시간 운영은 미연결. 브라우저 종료 후 새 가격을 수신하지 않음

### 자동화 준비실

- `PRICE_CROSS` 가격 이상·이하 전략 초안 생성과 수정
- 종목 마스터, 가격 범위, 호가단위, 수량, 1회 주문금액과 일일 예산의 서버 검증
- 클라이언트 입력과 무관하게 신규·수정 전략을 `paper + draft`로 강제
- 전략 실행 필드의 SHA-256 설정 해시와 현재 버전별 시나리오 진행률
- 사용자 입력 가격만 사용하는 수동 1회 판정과 idempotency key
- 조건 충족·조건 대기·안전검사 차단 결과, 가상 주문 내용과 실제 주문 미전송 기록
- 전략 변경 또는 판정과 실행 이력·감사 로그·중복 방지 기록을 각각 한 번에 반영하는 원자적 저장
- 증가형 전략 버전과 요청별 commit token을 이용한 수정 충돌 차단, 사용자별 CAS 감사 헤드
- 전략·실행 이력의 사용자별 소유권 검사, 사용자당 전략 50개 제한과 최대 조회 건수 제한
- 최근 이력은 제한해 내려주되 누적 점검 수와 현재 설정의 검증 진행률은 DB 집계로 정확히 계산
- 설정을 수정하면 검증 상태를 초안으로 되돌려 오래된 검증을 재사용하지 않음
- 자동화 화면에서는 불필요한 호가 조회·폴링·SSE를 열지 않고 엔진 화면에 진입할 때만 시장 이벤트를 구독

이 기능은 백테스트나 자동 실행기가 아닙니다. `WOULD_SUBMIT`은 “이 가정 가격이라면 조건이 충족된다”는 뜻이며 주문 접수·체결·수익을 의미하지 않습니다.

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

화면은 작업 목적에 따라 다섯 개의 공간으로 분리되어 있습니다. 기본 화면은 일반 사용자의 가치 흐름인 자동화 준비실입니다.

| 작업공간 | 대상 | 주요 작업 |
|---|---|---|
| 내 자동화 | 일반 사용자 | 가격 조건 전략, 예산, 수동 시나리오 점검, 결정 이력과 준비도 |
| 실거래 주문 | 일반 사용자 | 증권계좌 연결, 잔고 조회, 위험한도, 주문 미리보기, 주문·취소·대사 |
| 매칭엔진 검증 | 개발·QA | 가상 주문, 호가장, 경매, 체결 이벤트, 주문 원장 |
| 운영 모니터 | 운영자 | 저장소·이벤트 스트림·시장 상태·회원사 세션 확인 |
| 시스템 아키텍처 | 기술 검토자 | 구현 범위, 성능 기준선, 운영 전환 격차 확인 |

- 실거래와 가상 매칭 랩을 시각적·정보 구조상 분리해 mode error를 줄였습니다.
- 상단 상태는 하드코딩 문구가 아니라 readiness, 영속 저장소와 이벤트 스트림에서 계산합니다.
- 실주문 미리보기는 계좌·종목·매수/매도·주문 조건·수량·가격·라우팅·시세 시각과 남은 시간을 함께 표시합니다.
- 위험 작업은 영향 범위를 보여주는 키보드 접근 가능한 확인 대화상자를 사용합니다.
- 모바일에서는 다섯 개 작업공간을 44px 이상의 터치 영역을 가진 하단 내비게이션으로 제공합니다.

## 주요 기술적 선택

| 문제 | 선택 | 이유 |
|---|---|---|
| 금액 계산 오차 | 정수 가격·수량 | 부동소수점 반올림이 주문 우선순위와 위험 한도에 영향을 주지 않게 합니다. |
| 동일 시각 주문의 순서 | 단조 증가 sequence | wall-clock 동률이나 시간 역행과 무관한 전체 순서를 만듭니다. |
| 장애 후 상태 복원 | WAL 선기록 후 상태 변경 | 승인된 명령만 순서대로 재생하고 손상·누락을 즉시 감지합니다. |
| 외부 주문 타임아웃 | `UNKNOWN` + reconciliation | 재시도로 같은 주문이 두 번 나가는 문제를 막습니다. |
| 전략 수정 후 검증 무효화 | 실행 필드 설정 해시 | 이전 설정의 점검 결과를 바뀐 전략에 잘못 재사용하지 않습니다. |
| Paper 시나리오 중복 요청 | 사용자·전략별 idempotency journal | 네트워크 재시도에도 같은 판정 이력을 중복 생성하지 않습니다. |
| 사용자별 API 키 보관 | owner/record AAD를 포함한 AES-GCM | 다른 사용자나 레코드로 암호문이 바뀌어 사용되는 것을 방지합니다. |
| 실주문 동시 상태 변경 | PostgreSQL advisory lock + version CAS + idempotency | D1에서는 실주문 release gate가 열리지 않으며, PostgreSQL에서만 한도 검사와 주문 원장 생성을 직렬화합니다. |
| 인메모리 매칭 코어 | PostgreSQL 잠금 안에서 매 mutation 재복구 | 공개 D1 배포의 체결 mutation은 닫고, PostgreSQL 인스턴스는 최신 미체결 원장과 마지막 sequence를 복구한 뒤 순서대로 처리합니다. 회원사 gateway는 별도 단일-writer 승인 없이는 계속 닫힙니다. |
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
├─ app/                    # 자동화 준비실·운영 UI와 HTTP/SSE API
│  └─ api/                # 자동화, 주문, 게이트웨이, 시장정보, 실계좌 API
├─ engine/                 # 전략 판정, 매칭, 회원 게이트, 위험, 브로커 어댑터
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

프로덕션 빌드와 로컬 기동은 다음 순서로 검증합니다.

```powershell
npm run build
npm run start
```

로컬 PostgreSQL을 사용할 때 `.env.local`에 다음 값을 추가합니다.

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/trading_stock_system

# 개발 중에는 실주문 게이트를 잠근 상태로 유지합니다.
LIVE_TRADING_ENABLED=false
LIVE_ORDER_ROUTING_RELEASED=false
TRADING_ENVIRONMENT=member_certification
LIVE_MARKET_ENABLED=false
LIVE_TRADING_EGRESS_READY=false
CERTIFICATION_GATEWAY_ENABLED=false
MATCHING_ENGINE_SINGLE_WRITER=false

# 운영자 계정은 자동 생성되지 않습니다. 인증 제공자의 user ID를 명시합니다.
OPERATOR_USER_IDS=
```

브라우저에서 <http://localhost:3000>을 엽니다. 실제 비밀키는 저장소에 커밋하지 말고 배포 환경의 Secret 저장소에만 등록하세요.

## 환경변수

실제 값은 `.env.local` 또는 배포 환경의 Secret 저장소에만 보관합니다. `.env*`, `.coders/`, 개인키와 로컬 DB는 `.gitignore`에서 제외됩니다.

| 이름 | 목적 | 필수 여부 | 발급·설정 위치 |
|---|---|---:|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열과 분산 advisory lock | PostgreSQL 사용 시 | 운영 DB 제공자 콘솔 |
| `CREDENTIAL_ENCRYPTION_KEY` | 증권사 자격증명·토큰 AES-256-GCM 암호화 | 계좌 연결 시 | 배포별로 생성한 32자 이상의 무작위 비밀값 |
| `CERTIFICATION_GATEWAY_KEYS` | 회원사 시험 게이트웨이 HMAC 키 JSON | 게이트웨이 시험 시 | 회원사 인증 관리자가 발급, 운영은 PKI/mTLS로 대체 |
| `CERTIFICATION_GATEWAY_ENABLED` | 회원사 시험 주문접수 명시적 release gate | 인증 게이트웨이 사용 시 | 기본값 `false`; PostgreSQL·승인된 단일 writer 런타임 이후 변경 |
| `MATCHING_ENGINE_SINGLE_WRITER` | 인메모리 코어를 단일 writer에 고정했다는 운영 확인 | 인증 게이트웨이 사용 시 | 기본값 `false`; 다중 인스턴스에서는 사용 금지 |
| `LIVE_TRADING_ENABLED` | 외부 주문 전송의 서버 마스터 스위치 | 예 | 기본값 `false`; 운영 승인자가 배포 Secret으로 관리 |
| `LIVE_ORDER_ROUTING_RELEASED` | 실주문 라우터 최종 release gate | 실주문 출시 시 | 기본값 `false`; PostgreSQL 동시성·대사 검증 후 변경 |
| `TRADING_ENVIRONMENT` | `member_certification` 또는 `production` 경계 | 예 | 기본값 `member_certification` |
| `LIVE_MARKET_ENABLED` | 운영시장 사용 승인 스위치 | 예 | 기본값 `false`; 계약·운영 승인 후 변경 |
| `LIVE_TRADING_EGRESS_READY` | 등록된 고정 출발 IP 준비 여부 | 예 | 기본값 `false`; 증권사에 IP 등록 후 변경 |
| `OPERATOR_USER_IDS` | 시장 전체 상태를 변경할 운영자 user ID allow-list | 운영 기능 사용 시 | 인증 제공자의 사용자 ID, 쉼표 구분 |
| `SITE_URL` | canonical URL과 인증 return URL | 배포 시 권장 | `https://tradingstocksysyem.coders.kr` |
| `SITE_PROVIDER` | Coders 인증 헤더 사용 여부 | Coders 배포 시 | Coders 런타임이 `coders`로 제공 |
| `DB` binding | Cloudflare D1 데이터베이스 binding | D1 사용 시 | `.openai/hosting.json`의 `d1: "DB"`와 호스팅 설정 |

토스증권·한국투자증권·키움증권 키는 공용 서버 환경변수로 넣지 않습니다. 각 사용자가 화면에서 본인 자격정보를 연결하면 서버가 소유자 AAD를 포함해 암호화 저장합니다. 발급 경로와 지원 범위는 [증권사 지원 매트릭스](docs/BROKER_SUPPORT_MATRIX_KO.md)를 따릅니다.

## 데이터베이스

- `DATABASE_URL`이 있으면 PostgreSQL, 없으면 호스팅의 `DB` D1 binding을 사용합니다.
- 앱 시작 후 첫 요청에서 `db/trading.ts`의 공통 스키마와 인덱스를 `CREATE ... IF NOT EXISTS`로 확인합니다.
- 선언 스키마는 `db/schema.ts`, SQLite/D1 생성 migration은 `drizzle/`에 보관합니다.
- 스키마 변경 초안은 `npm run db:generate`로 만들고 생성 SQL과 snapshot을 반드시 리뷰합니다.
- PostgreSQL에는 SQLite용 migration 파일을 그대로 실행하지 않습니다. 별도 검토한 PostgreSQL migration과 롤백 계획을 준비해 앱 배포 전에 적용해야 합니다.
- 일부 호환 컬럼은 존재 여부를 검사해 추가하지만 전체 버전 migration runner나 롤백 기능은 없습니다. 컬럼·제약 변경은 백업, 사전 migration, 호환 코드 배포, 검증, 정리 순서로 운영해야 합니다.

`0011_famous_galactus.sql`은 주문 이외 이벤트까지 복원하는 엔진 순번 high-water 원장, `0012_light_raza.sql`은 격리 가상 운용 계좌와 명령 저널을 추가합니다. 가상 운용 잔고는 JSON의 안전한 정수 범위로 처리하며 기존 PostgreSQL 32비트 금액 컬럼에 넣지 않습니다. 실주문/기관 게이트웨이 활성화 전에는 기존 금액 컬럼 BIGINT/NUMERIC 이관과 장애 대사·outbox 검증이 추가로 필요합니다.

이번 자동화 준비실은 기존 `automation_strategies`, `automation_runs`, `order_idempotency`를 재사용하고 두 개의 보조 원장을 추가합니다. `audit_chain_heads`는 유일한 체인 leaf를 기준으로 사용자별 CAS 헤드를 구성하고, `automation_validation_progress`는 설정 해시별 누적 점검 수를 보관해 화면 조회 때 실행 원장을 반복 전체 스캔하지 않게 합니다. `0006_classy_slapstick.sql`은 보조 원장과 **leaf가 정확히 하나인 기존 사용자만** 이관하고, `0007_faulty_wrecker.sql`은 증가형 전략 버전, `0008_unknown_carlie_cooper.sql`은 원자적 변경 확인용 commit token, `0009_unknown_tempest.sql`은 leaf 탐색용 복합 인덱스를 추가합니다. `0010_first_captain_universe.sql`은 실주문 위험정책의 version·commit token과 주문 시점 예약금액인 `risk_notional`을 추가합니다. 앱과 `0006` migration guard는 다중 leaf를 하나라도 발견하면 readiness와 이후 DB 쓰기를 실패시키는 fail-closed 방식으로 동작합니다. 따라서 운영 적용 전 백업, 아래 사전 점검 결과 `0`, migration rehearsal이 모두 필요합니다.

```sql
SELECT COUNT(*) AS users_with_multiple_audit_leaves
FROM (
  SELECT candidate.user_id
  FROM audit_chain candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM audit_chain child
    WHERE child.user_id = candidate.user_id
      AND child.previous_hash = candidate.entry_hash
  )
  GROUP BY candidate.user_id
  HAVING COUNT(*) > 1
) forked_users;
```

## Java 매칭 코어

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

- 2026-10-28 기준 TypeScript 단위·SQLite 트랜잭션 통합 테스트: **66/66 통과**
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
| `GET/POST` | `/api/paper` | 격리 가상 계좌·명령 이력 조회, 시작·중지·취소·가격 기록 재생 |
| `GET/POST` | `/api/automation/strategies` | 내 전략·준비도 조회, Paper 초안 생성·수정 |
| `PATCH` | `/api/automation/strategies/{strategyId}` | 초안·검증완료·일시정지 상태 전환 |
| `POST` | `/api/automation/strategies/{strategyId}/evaluate` | 사용자 가격으로 조건을 한 번 판정, 주문은 미전송 |
| `GET` | `/api/automation/runs` | 사용자별 시나리오 판정 이력 조회 |
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

`/api/automation/*`는 증권사 API를 호출하지 않습니다. `/api/live/*` 경로가 존재해도 모든 서버·사용자 안전 게이트가 통과하지 않으면 외부 주문은 전송되지 않습니다.

## 실거래 전 확인사항

공개 데모의 환경변수 기본값은 `member_certification`, `LIVE_MARKET_ENABLED=false`, `LIVE_ORDER_ROUTING_RELEASED=false`, `CERTIFICATION_GATEWAY_ENABLED=false`입니다. 실주문은 PostgreSQL 분산 직렬화가 없는 D1 배포에서 열리지 않습니다. 아래 항목을 모두 충족하고 별도의 샌드박스·소액 검증을 마치기 전에는 release gate를 열면 안 됩니다.

- 증권사별 정식 API 사용 승인과 사용자 약관·위험 고지
- 증권사에 등록된 고정 출발 IP와 TLS/비밀키 운영 절차
- 사용자별 강한 인증, 권한 분리, 자격증명 교체·폐기 절차
- 주문·일·종목별 한도와 기본 활성 킬 스위치
- 위험정책 version CAS, 시장가 preview 금액 예약, 열린 주문 보유 시 연결 해제 차단
- 신규 주문 마스터 스위치가 내려가도 기존 주문 취소·대사는 유지하는 비상 절차
- 중복·타임아웃·부분 체결·장 마감·정정/취소 경합 대사 시험
- 감사로그, 지표, 경보, 온콜, 장애복구와 비상 중지 runbook
- 개인정보·전자금융·금융투자 관련 법률 및 계약에 대한 전문 검토

거래소 또는 다자간매매체결회사 운영을 목표로 한다면 브로커 API만으로는 부족합니다. 회원사 승인 프로토콜, 라이선스 시장데이터, 시장감시·규제보고, 청산·결제, 전용망·PKI/HSM, 이중센터와 성능·장애복구 인증이 별도로 필요합니다. 현재 차이는 [거래소 납품 준비 갭 매트릭스](docs/EXCHANGE_PRODUCT_GAP_MATRIX.md)에 기록했습니다.

## 로드맵

**Now — 가치 검증**

- [x] 가격 도달 전략 초안, 서버 검증과 설정 해시
- [x] 사용자 가격 기반 조건 충족·대기·차단 1회 판정
- [x] 사용자별 이력, 중복 실행 방지와 양쪽 시나리오 준비도
- [x] 자동화 중심 반응형 UI와 정직한 실주문 잠금 안내

**Next — 신뢰할 수 있는 모의 운용**

- [x] 사용자별 격리 Paper Broker와 가상 현금·포지션, 가격 기록 재생·원장 CSV
- [ ] 자동 전략 scheduler/runner, durable queue, lease, retry, outbox
- [ ] 라이선스 시세·증권사 샌드박스와 표준 market-data event 모델
- [ ] 주문·취소·부분체결·장 마감·대사 E2E 시험
- [ ] 실행 알림, 오류 분류, 재시작 복구와 관측성

**Later — 승인된 실거래와 사업화**

- [ ] 자동화 별도 위험동의, 단계적 한도와 실전 킬 스위치
- [ ] 다중 계좌·증권사, 팀 승인, 장기 감사와 운영 지원
- [ ] queue/backpressure, p99/p99.9 지연, active/standby와 RTO/RPO 검증
- [ ] 회원사 적합성, 시장감시, 규제보고, 청산결제 인터페이스

무료 핵심에는 전략 초안·수동 검증·기본 이력과 모든 안전장치를 둡니다. 향후 수익화 후보는 안정적인 상시 실행, 복합 조건, 다중 계좌·증권사, 장기 분석, 조직 권한과 SLA이며 “투자 수익” 자체를 판매하지 않습니다.

## 배포와 저장소 운영

### 저장소 토폴로지

```text
boclair98/TradingStockSysyem (canonical upstream, origin, main)
                  │
                  ├── GitHub fork sync ──> coders-kr/TradingStockSysyem
                  │
                  └── Coders deploy ─────> tradingstocksysyem.coders.kr
```

- Canonical upstream: <https://github.com/boclair98/TradingStockSysyem>
- Organization fork: <https://github.com/coders-kr/TradingStockSysyem>
- Public service: <https://tradingstocksysyem.coders.kr/>
- `coders-kr/TradingStockSysyem`은 canonical 저장소를 parent로 갖는 실제 GitHub fork입니다.
- 로컬 `origin`은 canonical 저장소를 가리키며 Sites 내부 원격은 `sites`로 분리합니다.

업데이트 순서는 다음과 같습니다.

```powershell
npm test
npx tsc --noEmit
npm run lint
git push origin main
gh repo sync coders-kr/TradingStockSysyem -b main
```

1. 공개 전 tracked/staged/new files와 전체 Git history에서 비밀값을 검사합니다.
2. canonical `main`을 먼저 push하고 remote full SHA를 확인합니다.
3. 실제 organization fork를 `gh repo sync`로 동기화하고 두 full SHA가 같은지 확인합니다.
4. 최신 <https://coders.kr/llms.txt>의 API 규격을 읽고 기존 `tradingstocksysyem` 프로젝트를 canonical URL에서 재배포합니다.
5. 배포가 `ready`가 될 때까지 기다린 뒤 `/`, `/api/health`, `/api/readiness`와 핵심 화면을 확인합니다.
6. 내부 Sites 배포도 사용하는 경우 같은 검증 commit을 별도 `sites` remote에 저장한 뒤 현재 공개 범위를 유지해 배포합니다.

Coders 토큰과 호스팅 자격증명은 `.coders/` 또는 승인된 Secret 저장소에서만 읽으며 명령, README, 로그와 Git history에 노출하지 않습니다.

## 반응형 검증

공개 전 아래 viewport에서 자동화 기본 화면, 다섯 작업공간 내비게이션, 폼, 빈 상태, 오류 상태와 인증 잠금 상태를 확인합니다.

| Viewport | 확인 항목 | 현재 결과 |
|---|---|---|
| 360 × 800 | 하단 5탭, 44px 터치 영역, 한국어 줄바꿈, 가로 overflow | 로컬·운영 Chrome 통과 |
| 390 × 844 | 전략 빌더, 가격 preset, 상태 메시지, safe-area | 로컬·운영 Chrome 통과 |
| 768 × 1024 | 1열 전환, sticky 탭, 카드·폼 clipping | 로컬·운영 Chrome 통과 · 계정 요약 넘침 수정 |
| 1440 × 900 | 2열 자동화 cockpit, 계층·간격·초점 이동 | 로컬·운영 Chrome 통과 |

2026-10-28 실제 Chrome에서 화면과 DOM 치수를 함께 확인했습니다. 운영 사이트의 다섯 작업공간을 모바일에서 이동했고, 가상 운용의 전략 저장→시작→기록 재생→가상 체결→중지→새로고침 복구를 PostgreSQL에서 확인했습니다. 로컬에서는 API 재전송의 1회 반영과 CSV 다운로드도 확인했습니다. 운영 페이지 오류 로그는 비어 있었고, 로컬 개발 로그의 Grammarly 삽입 속성 hydration 경고는 앱 오류와 분리했습니다. 대규모 부하·다중 리전 장애전환·DB 백업 복원은 검증하지 않았습니다.

## 보안과 사용 조건

- `.env*`, `.coders/`, API 키, 토큰, 인증서, 개인키, 로컬 DB, 로그와 업로드 파일을 공개 저장소에 커밋하지 않습니다.
- 증권사 자격증명은 사용자·레코드 AAD를 포함한 AES-256-GCM으로 암호화하고 API 응답과 감사로그에서 제외합니다.
- 자동화 준비실은 투자자문, 종목 추천, 수익 보장, 실시간 시세, 공식 주문 접수 서비스가 아닙니다.
- 실제 금융서비스 운영 전 관련 법률, 증권사 계약, 개인정보·전자금융, 투자자 보호에 대한 전문 검토가 필요합니다.
- 현재 별도 오픈소스 라이선스가 지정되어 있지 않습니다. 저작권자의 명시적 허락 없이 복제·재배포·상업적 이용할 수 없습니다.

보안 취약점 제보와 비밀 노출 대응은 [SECURITY.md](SECURITY.md)를 따릅니다.

## 관련 문서

- [거래소 납품 준비 갭 매트릭스](docs/EXCHANGE_PRODUCT_GAP_MATRIX.md)
- [목표 제품 아키텍처](docs/EXCHANGE_ARCHITECTURE.md)
- [장애전환·복구 Runbook](docs/FAILOVER_RUNBOOK.md)
- [성능 기준선](docs/PERFORMANCE_BASELINE.md)
- [운영 전환 경계](docs/PRODUCTION_READINESS.md)
- [실거래 브로커 출시 체크리스트](docs/LIVE_BROKER_RELEASE_KO.md)
- [증권사 지원 및 연결 매트릭스](docs/BROKER_SUPPORT_MATRIX_KO.md)
- [제품 가치·수익화 전략](docs/PRODUCT_STRATEGY.md)
