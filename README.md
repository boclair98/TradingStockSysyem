# TradingStockSysyem

국내 ATS(다자간매매체결회사)를 목표로 하는 매매체결 코어, 회원사 적합성 게이트웨이, 운영 통제·감사 UI 프로젝트입니다.

공개 기술실사 환경: <https://tradingstocksysyem.coders.kr/>

> **현재 판정: Engineering Evaluation Build.** 금융기관 PoC·코드 실사에는 사용할 수 있지만, 인가·회원사 적합성·시장감시·청산결제·이중센터 인증 전에는 실제 거래소로 운영하거나 “운영 인증 완제품”으로 판매할 수 없습니다.

## 왜 다시 구성했는가

개인 사용자의 증권사 App Key를 받아 주문을 중계하는 서비스는 거래소가 아닙니다. 실제 ATS에서는 증권사가 회원으로 접속하고 ATS가 다수 회원의 주문을 독립적으로 체결한 뒤 시장정보·체결보고·감시·청산결제 경계로 전달합니다.

따라서 프로젝트를 다음처럼 분리했습니다.

- `venue-core-java/`: API·웹·DB에서 분리된 Java 21 결정론적 매칭 코어
- `engine/memberGateway.ts`: 회원사 세션·순번·인증·중복·속도 적합성 게이트
- `engine/matchingEngine.ts`: 브라우저와 규칙 검증용 TypeScript 참조 엔진
- `db/`: 시험 원장·Drop Copy·감사 해시체인·운영 상태
- `app/`: 기술실사·운영 UI
- `engine/liveTradingService.ts`: 토스증권·한국투자증권 사용자 주문 라우팅 어댑터이며 ATS 코어와 분리

## 독립 Venue Core

Java 21 코어는 다음을 구현합니다.

- 정수 고정 가격·수량
- 종목별 가격·시간 우선 CLOB
- 지정가·보호가격 시장가, DAY·IOC·FOK
- 회원별 중복 ClientOrderId 차단
- CANCEL_AGGRESSOR 자기체결 방지
- 신규·취소·정정, 정정 시 시간 우선순위 상실
- 호가단위·수량단위·일일 가격범위
- 회원별 주문수량·주문금액·미체결·킬 스위치
- 전역 명령/이벤트 단조 증가 sequence
- CRC32C 프레임과 `fsync` 명령 WAL
- 저널 손상·부분 프레임·sequence gap 거부
- 재기동 명령 재생과 SHA-256 상태 다이제스트 비교

```powershell
powershell -ExecutionPolicy Bypass -File venue-core-java/scripts/test.ps1
powershell -ExecutionPolicy Bypass -File venue-core-java/scripts/benchmark.ps1
```

2026-08-09 개발 PC 기준으로 10만 건 비체결 DAY 명령을 약 144,902 commands/s로 처리했습니다. 이는 네트워크·동기복제·시장정보 fan-out·장애전환을 제외한 로컬 기준선이며 거래소 SLA가 아닙니다.

## 회원사 적합성 경계

- 회원/세션별 HMAC 인증 시험
- 연속 inbound/outbound sequence
- 중복 ClientOrderId 방지
- 회원 세션별 속도제한
- Execution Report와 Drop Copy
- 시장정보 스냅샷과 시장 sequence
- 취소전용·전면정지 운영 통제
- PostgreSQL advisory fencing 시험
- 주문·체결·감사 원장과 해시체인

## 증권사 실계좌 어댑터

토스증권 Open API와 한국투자증권 Open Trading API 기반 계좌 연결, 잔고·시세 조회, 현금 주문, 취소, 체결대사 기능이 별도 어댑터로 존재합니다. 토스증권 국내주식 주문은 공식 API 제약에 맞춰 SOR·DAY만 허용합니다.

이 어댑터는 ATS 회원사 접속 인터페이스를 대체하지 않으며 거래소 data-plane과 함께 배포해서는 안 됩니다. 실전 주문은 서버 스위치, 증권사 등록 고정 출발 IP, 사용자 위험동의, 킬 스위치 해제, 60초 주문 미리보기와 확인문구가 모두 통과해야 전송됩니다. 공개 배포는 주문 게이트가 잠긴 상태가 기본입니다.

## API가 아니라 먼저 필요한 자료

1. 대상 기관 승인 회원 주문·정정·취소·세션·Drop Copy 프로토콜
2. 종목·권리변동·시장상태·호가·체결 데이터 계약과 포맷
3. 시장감시·규제보고·원본 보존 요구
4. KRX/KSD 청산결제·대사·결제불이행 인터페이스
5. 회원 수, 종목 수, 평균/피크 msg/s, p99.99 지연 목표
6. RTO/RPO, 이중센터, 전용망, PKI/HSM, PTP 요구
7. 승인 업무규정과 회원사 적합성 테스트 케이스

## 문서

- [거래소 납품 준비 갭 매트릭스](docs/EXCHANGE_PRODUCT_GAP_MATRIX.md)
- [목표 ATS 제품 아키텍처](docs/EXCHANGE_ARCHITECTURE.md)
- [장애전환·복구 Runbook](docs/FAILOVER_RUNBOOK.md)
- [성능 기준선](docs/PERFORMANCE_BASELINE.md)
- [운영 전환 경계](docs/PRODUCTION_READINESS.md)
- [실거래 브로커 출시 체크리스트](docs/LIVE_BROKER_RELEASE_KO.md)

## 웹 검증

```powershell
npm.cmd run test:unit
npx.cmd tsc --noEmit
npm.cmd run build
```

테스트나 CI에서는 실제 증권사 주문 엔드포인트를 호출하지 않습니다.
