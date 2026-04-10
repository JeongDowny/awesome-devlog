# 설정 관리

## 전제 조건

- **Claude Code CLI** 설치 필수 (`claude` 명령어 사용 가능해야 함)
- Claude Code에 이미 로그인되어 있어야 함 (별도 API 키 불필요)

## 설정 파일

```
~/.devlog/config.json
```

```json
{
  "outputDir": "~/devlog"
}
```

## 초기 설정 플로우 (`devlog init`)

첫 실행 시 또는 `devlog init` 명령으로 설정을 진행한다.

```
$ devlog init

DevLog 초기 설정

◆  데브로그 저장 경로를 입력해주세요
│  ~/devlog

◇  설정이 완료되었어요! → ~/.devlog/config.json
```

## 저장 디렉터리 구조

`outputDir`에 다음 구조로 자동 생성된다:

```
<outputDir>/
├── daily/                          ← 시간순 RAW 일지
│   ├── 2026-04-09_1845.md
│   └── 2026-04-10_1930.md
└── projects/                       ← 프로젝트별 일지
    ├── 01_dnd/
    │   ├── CSS 호환성 이슈 수정.md
    │   └── 모바일 카드 UI 추가.md
    └── awesome-devlog/
        └── 날짜 선택 기능 추가.md
```

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `devlog` | devLog 생성 (메인 기능) |
| `devlog init` | 초기 설정 / 설정 재구성 |
| `devlog view` | 저장된 devLog를 HTML로 변환하여 브라우저에서 열기 |
| `devlog view <파일경로>` | 특정 마크다운 파일을 바로 열기 |
