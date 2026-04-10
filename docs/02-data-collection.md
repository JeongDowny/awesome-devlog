# 데이터 수집 소스

> 최종 갱신: 2026-04-10

## 전체 흐름에서의 위치

```
[1단계: 수집] ← 이 문서
├─ ~/.claude/history.jsonl → 날짜 범위 세션 인덱싱 (1회 읽기)
├─ ~/.claude/projects/<경로>/<UUID>.jsonl → 세션별 전체 대화 로그
└─ git log --since/--until → 날짜 범위 코드 변경 이력
```

## 1. 세션 전체 대화 로그 (핵심 소스)

```
~/.claude/projects/<프로젝트-경로>/<세션UUID>.jsonl
```

- 프로젝트 경로의 `/`와 `_`가 `-`로 치환되어 디렉터리명이 됨
- 레거시 규칙(`/`만 치환)도 fallback으로 지원
- JSONL 형식, 줄마다 하나의 메시지
- **사용자 입력 + Claude 응답 + 도구 호출 결과** 모두 포함

### 메시지 타입

| type | 설명 |
|------|------|
| `user` (role: user) | 사용자 입력 |
| `assistant` (role: assistant) | Claude 응답 (텍스트 + tool_use) |
| `system` | 시스템 메시지 (수집 제외) |
| `file-history-snapshot` | 파일 변경 스냅샷 (수집 제외) |

### 수집 시 필터링

- user/assistant 메시지만 추출
- tool_result 콘텐츠 블록 제거 (긴 코드 출력)
- `<system-reminder>`, `<local-command-caveat>` 등 XML 태그 제거
- 세션당 최대 60,000자 (초과 시 잘림)

## 2. history.jsonl (인덱스)

```
~/.claude/history.jsonl
```

- 사용자 입력만 저장 (Claude 응답 없음)
- 용도: 날짜 범위 내 어떤 프로젝트에서 몇 개 세션을 열었는지 빠르게 파악
- 필드: `display`, `timestamp`, `project`, `sessionId`, `pastedContents`

### 활용 방법

1. `indexSessionsInRange(startDate, endDate)`로 날짜 범위 엔트리 필터링 (1회 읽기)
2. `project` 필드로 프로젝트별 그룹핑
3. `sessionId`로 전체 대화 로그 파일 매칭

## 3. git log

```
git log --since=<startDate> --until=<endDate+1>
```

- 선택된 날짜 범위의 프로젝트별 코드 변경 이력 수집
- 커밋 해시, 메시지, 타임스탬프
- 프로젝트별 병렬 수집 (각 repo 경로에서 실행)
- 타임아웃: 10초

## 4. 워크트리 세션 병합

워크트리 세션은 같은 프로젝트의 브랜치 작업이므로, 메인 프로젝트로 병합한다.

```
워크트리: /path/.01_dnd-worktrees/video-upload
  → 메인 repo: /path/01_dnd
```

패턴: `<parent>/.name-worktrees/<branch>` → `<parent>/name`

## 5. 토큰 제한 대응 전략

세션 로그가 길어서 Claude 컨텍스트 한도를 초과할 수 있다. 다음 전략으로 대응:

1. history.jsonl로 날짜 범위 세션 목록을 먼저 파악 (인덱싱, 1회 읽기)
2. 세션별로 user/assistant 텍스트만 추출 (tool_result 제거)
3. 세션당 60,000자 제한
4. 전체 프롬프트 300,000자 초과 시 데이터 잘림
