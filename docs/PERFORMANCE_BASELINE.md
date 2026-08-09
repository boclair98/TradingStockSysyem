# 성능 기준선

## 현재 측정

- 일자: 2026-08-09
- 런타임: Java 21, 512 MiB heap
- 워크로드: 100,000건 비체결 DAY 지정가 명령, 100개 회원, 단일 종목
- 결과: 약 144,902 commands/second
- 결정론 상태 SHA-256: `2a3cf794f0dff6ce0cbf0d81fba2d6b149f28838aa778031c6acb79bbf993d3d`

이 숫자는 개발 PC의 단일 프로세스 throughput 기준선입니다. 네트워크, 내구성 복제, 시장정보 fan-out, GC tail latency, NUMA, 장애전환 비용이 포함되지 않았으므로 거래소 SLA가 아닙니다.

## 납품 인수시험에 추가할 항목

- 주문 유형별 p50/p99/p99.9/p99.99 end-to-end 지연
- 24시간 이상 peak soak 및 GC pause
- 10배 microburst와 회원별 공정성
- WAL 동기복제 포함 지연·처리량
- 종목 partition 수 증가에 따른 선형성
- 시장정보 구독자 수·패킷 손실·gap recovery
- 리더 강제종료 중 유실·중복·순서 역전 0건
- 전체 저널 재생과 스냅샷 복구 시간
- 이중센터 전환 RTO/RPO
