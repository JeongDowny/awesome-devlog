# CLAUDE.md — awesome-devlog

> Claude Code 세션 로그를 자동 수집·구조화하여 데브로그를 생성하는 CLI 도구

## 프로젝트 성격

- **CLI 도구** (npm 글로벌 패키지) — 웹앱이 아님
- 실행 명령: `devlog`
- 사용자: Claude Code를 쓰는 모든 개발자 (범용)

## 기술 스택

| 항목 | 선택 |
|------|------|
| 언어 | TypeScript (strict) |
| 런타임 | Node.js |
| 패키지 매니저 | pnpm |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) |
| CLI 인터랙션 + 출력 | @clack/prompts |
| 빌드 | tsup |
| Linter / Formatter | Biome v2 |

**이 프로젝트에서 사용하지 않는 것:** React, Next.js, Tailwind, Supabase, Zustand, TanStack Query

## 디렉터리 구조

```
src/
├── index.ts              # CLI 진입점 (bin)
├── commands/
│   ├── generate.ts       # devlog 메인 명령
│   └── init.ts           # devlog init (초기 설정)
├── collectors/
│   ├── session-log.ts    # Claude Code 세션 로그 수집
│   ├── history.ts        # history.jsonl 인덱싱
│   └── git-log.ts        # git log 수집
├── analyzer/
│   └── structurize.ts    # Claude API로 태스크 구조화
├── interactive/
│   └── questions.ts      # 인터랙티브 질문 흐름
├── writer/
│   └── markdown.ts       # 마크다운 파일 생성
├── config/
│   └── config.ts         # ~/.devlog/config.json 관리
├── types/
│   └── index.ts          # 전체 타입 정의
└── utils/
    └── path.ts           # 워크트리 경로 역추적 등
```

## 코딩 규칙

### TypeScript

- strict 모드 필수
- `any` 사용 금지 — `unknown` + 타입 가드 사용
- 모든 함수의 반환 타입 명시
- `interface`보다 `type` 우선 사용
- `enum` 금지 → `as const` 객체로 대체

### 네이밍

| 대상 | 형식 | 예시 |
|------|------|------|
| 파일명 | kebab-case | `session-log.ts` |
| 함수 | camelCase | `collectSessionLogs` |
| 타입 | PascalCase | `SessionEntry` |
| 상수 | UPPER_SNAKE_CASE | `DEFAULT_OUTPUT_DIR` |

### 에러 핸들링

- 에러를 조용히 삼키지 않는다 (`catch (e) {}` 금지)
- 사용자에게 보여주는 에러 메시지는 한국어
- `console.log` 직접 사용 금지 — 사용자 출력은 `@clack/prompts`의 `log.*`, `intro`, `outro`, `spinner` 사용

### Biome

```bash
pnpm lint          # biome lint ./src
pnpm check         # biome check ./src
pnpm check:fix     # biome check --write ./src
```

- 들여쓰기: 스페이스 2칸
- 줄 너비: 120자
- 커밋 전 `pnpm check` 통과 필수

## 핵심 도메인 지식

### Claude Code 세션 로그 구조

```
~/.claude/history.jsonl          → 사용자 입력 인덱스 (세션 목록 파악용)
~/.claude/projects/<경로>/<UUID>.jsonl  → 전체 대화 로그 (user + assistant + tool)
~/.claude/sessions/<PID>.json    → 세션 메타데이터
```

- 프로젝트 경로의 `/`가 `-`로 치환되어 디렉터리명이 됨
- 워크트리 경로(`<repo>-worktrees/<branch>`)는 메인 repo로 병합

### 설정 파일

```
~/.devlog/config.json
```

API 키 우선순위: 환경변수 `ANTHROPIC_API_KEY` > config.json > `devlog init` 안내

## 커밋 메시지 (Conventional Commits, 한국어)

```
feat(collector): 세션 로그 수집기 구현
fix(analyzer): 토큰 초과 시 세션별 요약 분할 처리
refactor(writer): 마크다운 템플릿 구조 개선
chore: tsup 빌드 설정 추가
```

## 기획 문서

상세 기획은 `docs/` 참조:

- `docs/01-overview.md` — 정의, 목적, 설계 원칙
- `docs/02-data-collection.md` — 수집 소스, 로그 구조, 토큰 대응
- `docs/03-ux-flow.md` — 인터랙티브 질문 설계, 저장 포맷
- `docs/04-configuration.md` — 설정 파일, API 키 관리
- `docs/05-development-plan.md` — 개발 단계

## 절대 하지 말 것

- `any` 타입 사용
- 환경변수(API 키 등) 코드에 하드코딩
- ESLint / Prettier 설정 파일 생성 (Biome 사용 중)
- 에러를 catch하고 아무것도 하지 않음
- `console.log` 커밋
- 저장 경로 하드코딩 (반드시 config에서 읽기)
