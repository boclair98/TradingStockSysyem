# 장애전환·복구 Runbook 기준선

## 즉시 안전 상태

1. 시퀀서 또는 WAL quorum 상실 시 신규·정정은 차단합니다.
2. 주문 상태가 확정되지 않으면 `UNKNOWN`으로 보존하고 자동 재전송하지 않습니다.
3. 취소 허용 여부는 사고 유형별 사전 승인된 운영 매트릭스를 따릅니다.
4. 시장정보 sequence gap이 발생하면 증분 송신을 중단하고 스냅샷+리플레이로 복구합니다.

## 승격 조건

- 대기 노드가 마지막 committed command sequence까지 재생 완료
- 주문장·체결·회원 노출·시장상태 다이제스트 일치
- fencing token 획득 및 구 리더 write 차단 확인
- PTP offset 허용범위 확인
- Drop Copy와 시장정보 최종 sequence 대사
- 운영자 2인 승인 및 사고 티켓 연결

## 복구 후 검증

- 회원별 inbound/outbound sequence 연속성
- 중복 ClientOrderId 및 중복 체결 없음
- 모든 체결의 양방 주문·가격·수량 보존
- 시장정보와 Drop Copy의 시장 sequence 일치
- 청산 전달 건수·금액과 체결 원장 일치
- 감사기록 해시체인과 외부 보존소 일치

현재 공개 배포는 이 runbook을 실행할 이중센터 인프라가 없으므로 운영시장 합격으로 표시하지 않습니다.
