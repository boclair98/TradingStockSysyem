# TradingStockSysyem

다중 사용자가 자기 명의 증권계좌를 연결해 국내주식 실시간 시세·잔고를 확인하고, 사전위험검사를 거쳐 실제 주문을 전송·취소·대사할 수 있는 거래 서비스입니다. 별도의 ATS 매칭엔진 랩과 기관 회원사 적합성 게이트웨이도 포함합니다.

공개 서비스: <https://tradingstocksysyem.coders.kr/>

> **실거래 주의:** `production` 연결과 `LIVE_TRADING_ENABLED=true`는 실제 현금 주문을 증권사로 전송합니다. 개발·CI·검증 과정에서는 절대로 실전 주문 API를 호출하지 마세요.

## 현재 지원 범위

- 사용자별 로그인, 계좌·주문·위험정책 데이터 격리
- 한국투자증권 Open Trading API 실전/모의 계좌 연결
- App Key, App Secret, 계좌번호, 토큰 AES-256-GCM 암호화 저장
- 실시간 국내주식 현재가 및 실계좌 잔고·보유종목 조회
- KRX, NXT, SOR 주문 라우팅
- 지정가·시장가 및 DAY·IOC·FOK 현금주문
- 주문 취소와 당일 주문·체결 원장 대사
- 주문당 수량·금액, 일일 주문금액, 미체결 건수 제한
- 서버 마스터 스위치, 사용자 실거래 동의, 킬 스위치
- 60초 단일사용 주문 미리보기와 정확한 확인문구
- 네트워크 타임아웃 주문을 `UNKNOWN`으로 보존해 맹목적 재전송 방지
- PostgreSQL advisory lock 기반 사용자별 주문 직렬화
- 가격·시간 우선 CLOB, 단일가, IOC/FOK, 자기체결 방지 ATS 랩
- 회원사 HMAC, 세션 순번, Drop Copy, 시장정보, 감사 해시체인

## 실거래 처리 흐름

```text
로그인 사용자
  -> 사용자별 암호화 Broker Vault
  -> KIS 토큰/실시간 시세/실계좌 잔고
  -> 사전위험검사와 매도가능수량 검사
  -> 60초 주문 미리보기 + 사용자 확인문구
  -> 내구성 원장에 PENDING 선기록
  -> KIS 현금주문(KRX/NXT/SOR)
  -> SUBMITTED / UNKNOWN 상태 보존
  -> 당일 주문·체결 대사
```

## 실거래 API

```text
GET/POST/DELETE /api/brokers                사용자 증권계좌 연결·해제
GET             /api/live/readiness         전체 실거래 준비상태
GET             /api/live/account           실계좌 잔고·보유종목
GET             /api/live/quote             국내주식 현재가
GET/PATCH       /api/live/risk              사용자 한도·동의·킬 스위치
POST            /api/live/orders/preview    시세·잔고·위험검사와 60초 미리보기
GET/POST        /api/live/orders            주문 원장 / 실제 주문 전송
GET/DELETE      /api/live/orders/:orderId   주문 조회 / 실제 취소
POST            /api/live/reconcile         당일 주문·체결 대사
```

모든 실거래 API는 로그인 사용자 소유권을 검사합니다. App Secret과 전체 계좌번호는 응답·UI·로그에 반환하지 않습니다.

## 필요한 설정

1. [한국투자증권 KIS Developers](https://apiportal.koreainvestment.com/)에서 사용자 본인의 실전 또는 모의투자 App Key/App Secret을 발급합니다.
2. 서버 비밀 저장소에 `CREDENTIAL_ENCRYPTION_KEY`를 등록합니다. 이미 암호화된 계좌가 있으면 이 키를 임의로 교체하면 안 됩니다.
3. 개발 중에는 `LIVE_TRADING_ENABLED=false`를 유지합니다.
4. 운영 승인이 끝난 배포에서만 `LIVE_TRADING_ENABLED=true`로 전환합니다.
5. 사용자는 웹 화면에서 자기 키·계좌번호 앞 8자리·상품코드(일반적으로 `01`)·KIS 고객 ID를 직접 등록합니다.

토스증권은 현재 이 서비스가 요구하는 일반 고객용 주문 Open API 연동 대상이 아닙니다. 토스 사용자는 토스 계좌를 직접 연결할 수 없으며, 정식 주문 API와 제휴·인가 범위가 확보된 뒤 별도 어댑터를 추가해야 합니다.

## 환경변수

```dotenv
CERTIFICATION_GATEWAY_KEYS={}
CREDENTIAL_ENCRYPTION_KEY=<64자 이상 무작위 비밀값>
LIVE_TRADING_ENABLED=false
```

로컬 사용자의 실제 App Key/App Secret은 `.env.local`이나 GitHub에 저장하는 대신 화면의 암호화 계좌 연결을 사용합니다. `.env*`, 토큰, 개인 메모 파일은 Git에서 제외됩니다.

## 개발 및 검증

```powershell
npm.cmd install
npm.cmd run test:unit
npx.cmd tsc --noEmit
npm.cmd run build
```

테스트는 모킹한 증권사 응답만 사용하고 실전 주문 엔드포인트에 접근하지 않아야 합니다.

## ATS 매칭엔진 랩

```text
Member Session
  -> HMAC / Sequence / Duplicate / Rate Check
  -> Pre-trade Risk
  -> Global Sequencer
  -> Deterministic Price-Time Matching Core
  -> Execution Report / Drop Copy / Market Data
  -> Durable Journal / Recovery
```

랩은 거래소 수준 책임 경계를 검증하기 위한 코드이며 실계좌 주문과 분리되어 있습니다. 법적 의미의 거래소나 다자간매매체결회사 운영에는 금융당국 인가, 회원사 전용망과 PKI/mTLS, 시장감시, KRX·예탁결제원 청산결제 규격, 이중 데이터센터, 공인 시각동기화, 대량 부하·장애복구·침투·회원사 적합성 시험이 별도로 필요합니다.
