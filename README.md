# MyRoutine Private

Supabase 없이 서버 PC의 SQLite에만 저장하는 Tailscale 전용 개인 루틴 앱입니다.

## 설계

- 서버: Node.js 기본 HTTP 서버 + `node:sqlite` (외부 패키지 없음)
- 바인딩: `127.0.0.1:8780` 전용
- 설치 화면: GitHub Pages 정적 PWA
- 데이터 API: Tailscale Serve private HTTPS `:8443`
- 데이터: `data/routine.db`
- 자동 백업: `backups/routine-YYYY-MM-DD.db`, 최근 30일 보존
- 설치형 웹앱: 매니페스트와 로컬 아이콘 사용
- 앱 식별자: `myroutine-private-v3` (Ozone Monitor와 다른 GitHub Pages 출처)
- 서비스 워커: 설치 판정용 네트워크 전용 방식(캐시·오프라인 저장 없음)

## 주요 기능

- 오늘 화면과 주간 그리드
- 체크형·수치형 루틴
- 실행 요일 선택
- 완료일부터 다시 세는 1~365일 간격 루틴
- 달력 월 안에 한 번 완료하는 월간 루틴
- 오늘 화면 하단의 주기 루틴 예정·기한 지남·완료 표시
- 모바일용 고정 색상 팔레트
- 작성 중 자동 동기화가 발생해도 입력 내용을 유지하는 편집창
- 목표 미달(진행 중)과 달성 구분
- 주기 루틴과 분리된 요일 루틴 주간 통계
- 현재/최고 연속 달성
- 순서 변경, 보관, 복원
- JSON 내보내기·가져오기
- 서버 상태와 마지막 동기화 시각
- SQLite 자동/수동 백업

## 실행

Node.js 22.5 이상이 필요합니다. 이 PC에서는 Codex 번들 Node.js 24 런타임도 자동 탐색합니다.

```powershell
.\manage_server.ps1 start
.\manage_server.ps1 status
.\manage_server.ps1 stop
```

로컬 확인: `http://127.0.0.1:8780/`

## Tailscale 배치

기존 LS PLC용 443 Funnel과 4900 서버는 변경하지 않습니다. 루틴 앱은 다른 포트의 private Serve를 사용합니다.

```powershell
tailscale serve --bg --https=8443 8780
tailscale serve status
```

접속 주소: `https://desktop-mlfbsh0.tail8f353a.ts.net:8443/`

Android 설치 주소: `https://sosu7985-jpg.github.io/myroutine-pwa/public/`

GitHub Pages에는 정적 화면 파일만 배포합니다. 데이터 API는 위 Tailscale 주소로만
호출하며, 서버는 정확히 `https://sosu7985-jpg.github.io` 출처만 CORS로 허용합니다.

2026-09-26 적용 및 검증했습니다. 기존 PLC용 공개 Funnel `443 -> 4900`은 그대로이고,
루틴 앱의 `8443 -> 8780`만 tailnet 전용으로 추가했습니다.

## 시험

```powershell
node --check server.js
node --check public/app.js
node --test
```

## 운영 주의사항

- 앱 서버를 Funnel로 공개하지 않습니다.
- `data`와 `backups` 폴더를 공개 Git에 포함하지 않습니다.
- Windows 작업 스케줄러의 `MyRoutine Server` 작업이 로그인할 때 서버를 시작합니다.
- 통합 운영대시보드 등록은 실제 휴대폰 시험과 사용자 검토가 끝난 뒤 진행합니다.
- Supabase 프로젝트 삭제와 GitHub Pages 비활성화도 새 앱 검증 이후 진행합니다.
