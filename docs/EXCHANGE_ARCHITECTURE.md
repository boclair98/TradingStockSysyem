# 목표 ATS 제품 아키텍처

```text
회원사 전용회선 A/B
  -> L4 / DDoS / IP allowlist
  -> mTLS Session Gateway (독립 inbound sequence)
  -> Protocol Decoder / Schema Validation
  -> Pre-trade Risk / STP / Market State Gate
  -> Durable Global Sequencer
  -> Replicated Command WAL (RPO 0 목표)
  -> Deterministic Matching Partition
  -> Execution Report / Drop Copy
  -> Ordered Market Data Publisher / Gap Recovery
  -> Surveillance / Regulatory Journal
  -> Clearing & Settlement Adapter
```

## 책임 경계

- **Data plane:** 주문접수, 시퀀싱, 위험검사, 매칭, 체결보고, 시장정보. GC·DB·HTTP를 매칭 hot path에서 제거합니다.
- **Control plane:** 회원·종목·한도·세션·시장단계·비상정지의 이중승인 변경과 감사기록을 담당합니다.
- **Regulatory plane:** 불공정거래 감시, 주문·체결 원본 보존, 시각증명, 규제기관 보고를 담당합니다.
- **Post-trade plane:** 청산기관·예탁결제기관과 거래·수수료·의무를 대사합니다.

## 코어 원칙

1. 모든 금액·가격·수량은 정수 고정소수점으로 처리합니다.
2. 외부 시간은 명령 입력값일 뿐 매칭 순서는 단일 단조증가 sequence가 결정합니다.
3. 명령은 내구성 저널에 기록된 뒤에만 상태를 변경합니다.
4. 동일 저널 재생은 동일한 주문·호가·체결 다이제스트를 생성해야 합니다.
5. 불확실한 장애 상태에서 명령을 자동 재전송하지 않습니다.
6. hot path에 원격 DB 트랜잭션, REST 호출, 동적 설정 조회를 두지 않습니다.
7. 운영 변경은 버전·예상버전·이중승인·감사 이벤트를 가집니다.

## 현재 저장소 매핑

- `venue-core-java`: 독립 결정론적 data-plane 기준선
- `engine/memberGateway.ts`: 회원 프로토콜 적합성 시험 경계
- `engine/matchingEngine.ts`: 브라우저/TypeScript 규칙 참조 구현
- `db/trading.ts`: 시험 원장·감사·운영 control-plane 저장
- `app`: 운영·기술실사 UI
- `engine/liveTradingService.ts`: 별도 증권사 라우팅 어댑터이며 ATS 코어가 아님
