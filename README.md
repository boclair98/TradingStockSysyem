# TradingStockSysyem

국내 주식시장과 대체거래소(ATS) 환경을 가정한 매매체결 시스템 연구·검증 프로젝트입니다.
가격·시간 우선 매칭엔진과 한국시장 세션 규칙을 브라우저 운영 콘솔에서 확인할 수 있으며,
현재는 외부 거래소 API 없이 가상 주문만 처리합니다.

> **중요:** 이 프로젝트는 실거래소나 증권계좌에 연결되어 있지 않습니다. 현재 입력되는 주문과
> 호가는 검증을 위한 로컬/가상 데이터이며, 실제 주문·청산·결제를 수행하지 않습니다.

## 공개 데모

- [TradingStockSysyem 운영 콘솔](https://tradingstocksysyem.coders.kr/)

화면 상단의 종목 선택기에서 삼성전자, SK하이닉스, NAVER, 현대차, 카카오, KODEX 200을
가상 종목으로 전환할 수 있습니다. 종목별로 호가창, 주문 입력, 체결 이벤트가 분리됩니다.

## 주요 기능

- 가격·시간 우선(price/time priority) 매칭
- 지정가·시장가·중간가·스톱지정가 주문(가상 엔진 검증용)
- GTC·IOC·FOK 유효조건
- 주문 취소·정정 및 미체결 전체취소
- `CANCEL_TAKER` 자기체결 방지 정책
- 집계 호가창과 append-only 체결/감사 이벤트
- 개장·종가 동시호가와 단일가 경매(uncrossing)
- NEXTRADE ATS 세션 상태와 주문 게이트
- KOSPI/KOSDAQ 가격대별 호가단위와 가격제한폭 검증
- KRX/NEXTRADE 후보 호가를 비교하는 결정론적 SOR 함수
- API 연결 전 검증을 위한 다중 가상 종목 마스터
- 서버 재시작 후 원래 수량·잔량·가격·시간 우선순위를 보존하는 주문 저널 복구
- 잔고검사부터 체결·원장저장까지 겹치지 않게 처리하는 주문 변경 직렬화
- 사용자별 예약금액·미체결 한도·감사기록 운영 화면
- 인증된 사용자 전용 리스크·감사 API와 서버 일괄취소
- 데이터베이스 응답시간·복구 주문수·안전장치 readiness 진단

## 구성

```text
app/page.tsx                    운영 콘솔 UI와 종목 선택/주문 입력
engine/matchingEngine.ts        주문원장, 검증, 매칭, 경매, 이벤트 로그
engine/brokerGateway.ts         증권사 공통 주문·시세·계좌 어댑터 계약과 준비상태
engine/koreanMarketRules.ts    한국시장 호가단위·세션·가격범위 규칙
engine/smartOrderRouter.ts      KRX/NEXTRADE 최우선 후보 선택 로직
tests/                          매칭엔진·한국시장 규칙 테스트
coders.yaml                     coders.kr web 서비스 설정
Dockerfile                      재현 가능한 컨테이너 빌드
```

## 로컬 실행

요구사항: Node.js `>=22.13.0`

```bash
npm install
npm run dev
```

개발 서버는 기본적으로 `http://localhost:3000`에서 실행됩니다.

## 검증 명령

```bash
npm run build
npm run test:unit
npx eslint app/page.tsx engine/matchingEngine.ts
```

매칭엔진 테스트는 `tests/matchingEngine.test.ts`, 한국시장 규칙 테스트는
`tests/koreanMarketRules.test.ts`에 있습니다.

## API 연결 전후의 경계

현재 엔진은 전송 계층과 분리된 순수 매칭 코어입니다. 실제 서비스를 준비할 때는 다음
어댑터를 별도 서버 계층으로 연결해야 합니다.

1. 실시간 시장데이터 수신(WebSocket/FIX 등)
2. 증권사 주문 제출·취소·정정 게이트웨이(REST/WebSocket/전용 API 등)
3. 사용자 인증·계좌·잔고·권한 검사
4. 사전 리스크 검사와 주문 한도
5. 체결 저널 영속화, 장애 복구, 시간 동기화
6. 청산·결제·감사 및 거래소 운영 연계

API가 연결되기 전에는 현재의 가상 피드와 수동 주문 입력으로 매칭 규칙, 세션 전환,
경매, 자기체결 방지, 오류 처리를 반복 검증할 수 있습니다. 실거래에 사용하려면 거래소/
증권사 연동, 운영 이중화, 보안·감사 체계와 별도 적합성 검토가 필요합니다.

## 배포

`coders.yaml`과 `Dockerfile`은 coders.kr의 `web` 서비스 배포를 위한 설정입니다.
배포 토큰이나 API 키는 저장소에 커밋하지 말고 호스팅 환경의 비밀값으로 관리해야 합니다.

## API 준비 상태

배포본은 아래의 paper API를 제공합니다. 모든 주문은 현재 프로세스의 가상 매칭엔진에서만
처리되며 `live: true` 요청은 의도적으로 거부됩니다.

```text
GET    /api/health
GET    /api/readiness
GET    /api/instruments
GET    /api/book?symbol=005930
GET    /api/orders
POST   /api/orders
DELETE /api/orders (현재 사용자의 미체결 전체취소)
DELETE /api/orders/{orderId}
POST   /api/orders/{orderId} (정정)
GET    /api/events?afterSequence=0
GET    /api/risk
GET    /api/audit?limit=50
GET    /api/broker/quote?symbol=005930
GET    /api/broker/account?participantId=api-paper
```

`GET /api/risk`와 `GET /api/audit`는 로그인한 사용자 본인의 정보만 반환합니다. 전체
미체결 취소는 `DELETE /api/orders` 한 번으로 서버에서 순차 처리합니다. 공개 이벤트 피드는
참가자 식별자가 포함된 주문 접수·거부 이벤트를 내보내지 않고 체결 및 시장상태만 제공합니다.

주문 제출 예시:

```json
{
  "symbol": "005930",
  "participantId": "sandbox-user",
  "side": "BUY",
  "type": "LIMIT",
  "timeInForce": "GTC",
  "price": 70000,
  "quantity": 10
}
```

중간가 주문은 `type`을 `MIDPOINT`로 지정하고 가격을 생략합니다. 현재 호가창에 양쪽
호가가 모두 있을 때 기준 중간가격으로 가상 주문을 생성합니다. 스톱지정가는 `type`을
`STOP_LIMIT`으로 지정하고 `price`와 `stopPrice`를 함께 보내며, 발동 전에는
`PENDING_TRIGGER` 상태로 감사 이벤트에 남습니다. 이 동작은 외부 NBBO·거래소 프로토콜이
없는 paper 검증 구현이며, 실거래소의 동적 중간가·스톱 주문 규격을 대체하지 않습니다.

paper 엔진에는 참가자별 기본 사전 한도(주문수량 100,000주, 주문금액 10억원, 미체결
1,000건)가 있으며, 실제 계좌·잔고·신용·공매도 한도를 대신하지 않습니다.

`GET /api/readiness`는 선택한 증권사 어댑터에 필요한 환경변수의 존재 여부만 알려주며,
비밀값 자체는 반환하지 않습니다. 기본값은 `BROKER_PROVIDER=paper`,
`BROKER_MODE=paper`입니다. `korea_investment`, `kiwoom`, `shinhan`, `samsung`,
`generic` 공급자 식별자를 지원하며, 실제 전송 구현은 선택한 증권사의 공식 sandbox 문서가
제공된 뒤 연결합니다.

증권사 연동에 사용하는 공통 설정은 `BROKER_API_BASE_URL`, `BROKER_WEBSOCKET_URL`,
`BROKER_APP_KEY`, `BROKER_APP_SECRET`, `BROKER_ACCOUNT_ID`이며, 주문별로
`venuePreference`를 `AUTO`, `KRX`, `NEXTRADE` 중 하나로 전달할 수 있습니다. 해당 증권사가
직접 시장 선택을 지원하지 않으면 `AUTO`를 사용하고 증권사의 최선집행/SOR 정책에 맡깁니다.
