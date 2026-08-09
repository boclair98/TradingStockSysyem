# TradingStockSysyem

기관 회원사 주문을 수신해 가격·시간 우선으로 체결하는 ATS(다자간매매체결회사) 적합성 시험 시스템입니다. 개인 자동매매나 증권사 Open API 중계 서비스가 아닙니다.

## 처리 구조

```text
Member Session
  -> Order Entry Gateway
  -> Authentication / Sequence / Duplicate / Rate Check
  -> Pre-trade Risk
  -> Global Sequencer
  -> Deterministic Matching Core
  -> Execution Report / Drop Copy / Market Data
  -> Durable Journal / Recovery
```

## 구현 범위

- 종목별 중앙지정가호가장(CLOB)
- 가격·시간 우선 및 maker price 체결
- 지정가, 시장가, IOC, FOK, 중간가, 스톱지정가
- 개장·종가 단일가와 연속매매 세션
- 자기체결 방지(CANCEL_TAKER)
- 회원사 HMAC-SHA256 메시지 인증
- 세션별 연속 입력 순번과 중복 주문 방지
- 회원사 세션별 1,000 msg/s 시험 한도
- Execution Report(Message 8)와 Drop Copy
- 시장정보 스냅샷(Message W)과 시장 시퀀스
- 주문 저널, 미체결 복구, 감사 해시체인
- PostgreSQL advisory lock 기반 다중 인스턴스 매칭 직렬화
- 취소전용·전면정지·시장단계 운영 통제

## 주요 API

```text
POST   /api/gateway/order-entry       회원사 신규주문(Message D)
GET    /api/gateway/operations        게이트웨이·세션·지연 운영상태
GET    /api/market-data/snapshot      중앙호가장 스냅샷(Message W)
GET    /api/book                      운영 콘솔 호가장
POST   /api/orders                    로그인 시험회원사 주문
POST   /api/orders/:orderId           주문 정정
DELETE /api/orders/:orderId           주문 취소
GET    /api/readiness                 엔진·저장소·게이트웨이 준비상태
PATCH  /api/operations/venue          시장 운영 통제
```

외부 게이트웨이는 `CERTIFICATION_GATEWAY_KEYS`에 등록된 회원사 ID와 HMAC 비밀키를 사용합니다. 비밀값은 소스에 저장하지 않고 호스팅 비밀 저장소에 등록해야 합니다.

```json
{
  "MEMB01": "a-long-random-certification-secret"
}
```

주문 메시지는 `X-Member-Signature` 헤더에 정규화된 메시지의 HMAC-SHA256 16진수 서명을 전달합니다. 세션 순번은 1부터 끊김 없이 증가해야 하며, 순번 공백은 `SEQUENCE_GAP`으로 거부됩니다.

## 검증

```powershell
npm.cmd run test:unit
npx.cmd tsc --noEmit --allowImportingTsExtensions
npx.cmd next build
```

## 운영시장 전환에 필요한 외부 조건

이 저장소는 운영시장과 동일한 책임 경계를 학습·검증하는 적합성 시험 구현입니다. 실제 ATS 운영에는 코드 외에도 금융당국 인가, 회원사 전용망과 PKI/mTLS, 공인 시각동기화, 시장감시 연계, KRX·예탁결제원 청산결제 규격, 이중 데이터센터, 대량 부하·장애복구·침투 시험 및 회원사 적합성 인증이 필요합니다.

공개 시험 URL: <https://tradingstocksysyem.coders.kr/>
