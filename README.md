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
- 지정가·시장가 주문
- GTC·IOC·FOK 유효조건
- 주문 취소·정정 및 미체결 전체취소
- `CANCEL_TAKER` 자기체결 방지 정책
- 집계 호가창과 append-only 체결/감사 이벤트
- 개장·종가 동시호가와 단일가 경매(uncrossing)
- NEXTRADE ATS 세션 상태와 주문 게이트
- KOSPI/KOSDAQ 가격대별 호가단위와 가격제한폭 검증
- KRX/NEXTRADE 후보 호가를 비교하는 결정론적 SOR 함수
- API 연결 전 검증을 위한 다중 가상 종목 마스터

## 구성

```text
app/page.tsx                    운영 콘솔 UI와 종목 선택/주문 입력
engine/matchingEngine.ts        주문원장, 검증, 매칭, 경매, 이벤트 로그
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
npx eslint app/page.tsx engine/matchingEngine.ts
```

매칭엔진 테스트는 `tests/matchingEngine.test.ts`, 한국시장 규칙 테스트는
`tests/koreanMarketRules.test.ts`에 있습니다.

## API 연결 전후의 경계

현재 엔진은 전송 계층과 분리된 순수 매칭 코어입니다. 실제 서비스를 준비할 때는 다음
어댑터를 별도 서버 계층으로 연결해야 합니다.

1. 실시간 시장데이터 수신(WebSocket/FIX 등)
2. 주문 제출·취소·정정 게이트웨이(FIX/전용 API 등)
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

