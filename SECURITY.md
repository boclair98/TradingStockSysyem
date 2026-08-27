# Security Policy

Trading Stock System은 주문·계좌·API 자격증명처럼 민감한 금융 데이터를 다루는 엔지니어링 프로젝트입니다. 공개 배포의 외부 주문 전송은 기본적으로 차단되어 있으며, 이 저장소만으로 운영 거래소 또는 인가된 투자 서비스가 되지는 않습니다.

## 취약점 제보

보안 문제는 공개 Issue에 작성하지 말고 GitHub의 **Private vulnerability reporting** 기능으로 제보해 주세요. 다음 정보만 포함합니다.

- 영향을 받는 파일·API와 재현 조건
- 예상 영향과 필요한 권한
- 비밀값을 제거한 로그 또는 화면
- 가능한 완화 방법

실제 증권사 API 키, 계좌번호, 접근 토큰, 개인정보, 주문 원문은 첨부하지 마세요.

## 비밀정보 처리

- `.env.local`, 증권사 API 키와 암호화키는 Git에 커밋하지 않습니다.
- 운영 비밀값은 배포 환경의 Secret 저장소에만 등록합니다.
- `CREDENTIAL_ENCRYPTION_KEY`는 배포 환경마다 독립적으로 생성하고 교체 절차를 준비합니다.
- 키가 노출되었다고 의심되면 저장소 삭제보다 먼저 증권사에서 해당 키를 폐기·재발급합니다.

## 운영 안전 기본값

다음 설정은 공개·검증 환경에서 잠긴 상태를 유지해야 합니다.

```dotenv
LIVE_TRADING_ENABLED=false
LIVE_TRADING_EGRESS_READY=false
LIVE_MARKET_ENABLED=false
TRADING_ENVIRONMENT=member_certification
```

운영자 권한은 첫 로그인 사용자에게 자동 부여하지 않습니다. 인증 제공자가 발급한 사용자 ID를 배포 환경의 `OPERATOR_USER_IDS` allow-list에 명시해야 합니다.

## 지원 범위

현재 `main`과 배포 중인 버전의 보안 문제를 우선 처리합니다. 브로커 어댑터는 코드와 고정 응답 기반 테스트 범위이며, 증권사 운영 승인이나 실제 자금 보호를 보증하지 않습니다.
