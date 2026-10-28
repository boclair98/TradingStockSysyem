# 가상 운용 작업공간 설계

## 범위와 근거

2026-10-28. 기존 Vinext/React, graphite/teal 토큰, 인증, 증권사 API와 기존 사용자 변경을 유지한다. `AutomationStudio.tsx`는 수동 조건 판정만 제공한다. `/api/readiness` 운영 응답은 PostgreSQL이 정상이나 가상 계좌를 가진 전략 운용 흐름이 없다. 주요 사용자는 자신의 가격 조건을 가상 자금으로 시험하려는 개인이다. 첫 행동은 저장한 전략을 선택하고 격리된 가상 운용을 시작하는 것이다.

## Resolved inputs

- Topic: 사용자별 주식 가상 운용
- Offer: 전략 초안을 가상 계좌에서 가격 기록으로 실행하고 잔고·주문·수수료·체결을 확인
- Audience: 국내 주식 자동화 규칙을 시험하는 사용자
- Primary user action: 가상 운용 시작 → 가격 기록 재생
- Deliverable: 기존 대시보드의 React 운용 패널과 서버 API
- Style direction: 기존 정밀한 거래 터미널의 graphite/teal 유지
- Tonal key: Dark
- Icon policy: 기존 기호 최소 재사용, 장식 이미지 없음
- Proof assets: DB에 저장된 사용자의 가상 원장만 사용; 실제 시세·수익·고객 수를 만들지 않음
- Motion intensity: Minimal; 처리 상태만 표시, reduced-motion 준수

## Composition contract

- Hero archetype: 기존 작업공간 헤더를 유지하는 업무 도구. 마케팅 히어로를 추가하지 않는다.
- First-viewport structure: 가상 운용 설명, 가상 현금·평가액·실현손익 요약, 전략 선택/시작 CTA, 가격 기록 입력의 다음 영역
- Primary visual/proof artifact: 사용자 가상 주문 원장과 잔고
- Interaction behavior: `가상 운용 시작`은 POST /api/paper 운영 세션 생성. `가격 기록 재생`은 순차 틱을 서버에서 평가하고 원장과 명령을 원자적으로 저장. `운용 중지`는 세션을 중단하고 미체결을 취소. CSV 다운로드는 현재 사용자의 실제 저장 원장.
- Reuse boundary: 기존 폼·버튼·토큰·전략 조회를 재사용. 실주문 API, 거래소 LAB 원장은 혼합하지 않는다.

## 시각 규칙

기존 `--canvas:#0b0e12`, `--panel:#14181e`, `--ink:#f4f7f8`, `--muted:#a5adb9`, `--cyan:#62dfd6`, `--green:#43d394`, `--red:#ff7884`, `--amber:#f0b65e`, `--line:#2a303a`를 쓴다. Inter/Pretendard/Noto Sans KR/Segoe UI/sans-serif를 유지한다. 본문 14px/1.6, 보조 12px/1.5, 섹션 제목 20px/700, 금액 24px/700 tabular-nums. 패널 20px, 요소 간격 12~20px, 반경 12px, 1px 경계. 입력/버튼 최소 44px. 데스크톱은 요약 4열, 제어와 원장 2열; 768px 아래 한 열. 테이블만 명시적 내부 가로 스크롤. 한국어 keep-all, 긴 ID overflow-wrap:anywhere, 모든 grid/flex 자식 min-width:0.

## 기능과 상태

로그인 전에도 설명·입력 구조는 읽을 수 있고 저장 조작에는 로그인 안내. 로딩·빈 전략·빈 원장·예산 부족·중복 요청·다른 탭 수정 충돌·입력 오류의 다음 행동을 표시. 시작 자금은 가상 1억원, 수수료는 가정 0.015%(실제 증권사 요율/세금 아님), 체결 모델은 입력 가격과 틱별 수량 한도. 동일 사용자 원장 CAS와 idempotency, 일별 KST 한도, 중복/역순 틱 거부. 데이터 출처는 USER_REPLAY. 공용 실시간 시세는 라이선스와 공급자 규격 확보 후 별도 어댑터로 연결한다.

## Filled generation prompt

기존 Trading Stock System의 주식 가상 운용 작업공간 하나를 React로 완성한다. 사용자는 자동화 규칙을 가상 자금으로 검증하는 개인이다. 제공 기능은 전략 선택, 격리된 가상 계좌, 가격 기록 재생, 가상 체결과 원장 다운로드다. 최우선 CTA는 가상 운용 시작이고 보조 CTA는 원장 CSV 다운로드다. 기존 graphite/teal 업무 도구의 시각 언어와 토큰을 유지한다. DB 원장만 증거로 제시하고 가상 결과를 실제 시장 수익으로 표현하지 않는다. 기존 헤더 아래 가상 자산 요약, 세션 제어, 가격 입력과 주문 원장을 명확한 위계로 배치한다. 조작 피드백에만 최소 모션을 쓰고 reduced-motion을 존중한다. 의미 있는 폼 레이블, 키보드 포커스, 오류 안내, 44px 조작 영역, 모바일 단일 열을 구현한다. 기존 인증과 API 계약을 보존하고 불필요한 의존성을 추가하지 않는다.

## Output target / 검증

`app/PaperTradingPanel.tsx`, `app/AutomationStudio.tsx`, `app/globals.css`, `app/api/paper/route.ts`, `engine/paperSimulation.ts`, `db/paperSimulation.ts`, schema/migration, 운영 안내 문서. 순수 엔진의 잔고·부분체결·예약·취소·예산·시간순 검증, DB CAS/중복 명령 원자성, 타입/빌드/렌더 검증. 가능한 브라우저에서 360×800, 390×844, 768×1024, 1440×900 및 주요 폼·포커스·오버플로를 확인한다. 배포는 기존 tradingstocksysyem.coders.kr에 수행한다.
