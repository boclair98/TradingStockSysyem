# TradingStockSysyem Venue Core

API·웹 프레임워크·데이터베이스에서 분리된 Java 21 결정론적 매칭 코어입니다. 가격과 수량은 부동소수점이 아닌 `long` 고정 정수로 처리하며, 동일한 명령 저널을 재생하면 동일한 상태 다이제스트가 나와야 합니다.

이 모듈은 거래소 제품화의 코어 기준선이지 규제기관·회원사 인증을 통과한 운영 바이너리가 아닙니다.

## 제공 기능

- 종목별 가격·시간 우선 중앙지정가호가장
- 지정가·보호가격 시장가, DAY·IOC·FOK
- 회원별 중복 ClientOrderId 차단
- CANCEL_AGGRESSOR 자기체결 방지
- 신규·취소·정정과 정정 시 우선순위 상실
- 종목 호가단위·수량단위·±30% 가격범위
- 회원별 주문수량·주문금액·미체결·킬 스위치
- 전역 명령/시장 이벤트 단조 증가 순번
- CRC32C 프레임, `fsync`, 부분 프레임 감지 저널
- 명령 저널 재생과 결정론적 상태 다이제스트

## 검증

```powershell
powershell -ExecutionPolicy Bypass -File venue-core-java/scripts/test.ps1
powershell -ExecutionPolicy Bypass -File venue-core-java/scripts/benchmark.ps1
```

프로덕션 전환 전에는 승인된 회원 프로토콜, mTLS/HSM, PTP 시간동기화, 이중화 시퀀서, 무손실 시장정보, 시장감시, 청산결제 및 독립 성능·장애복구 인증이 추가되어야 합니다.
