// 설정
export type DevlogConfig = {
  outputDir: string;
};

// 세션 출처 (Claude Code / Codex CLI)
export const SESSION_SOURCE = {
  CLAUDE: "claude",
  CODEX: "codex",
} as const;

export type SessionSource = (typeof SESSION_SOURCE)[keyof typeof SESSION_SOURCE];

// Claude Code history.jsonl 엔트리
export type HistoryEntry = {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
  pastedContents: Record<string, { id: number; type: string; content: string }>;
};

// Codex CLI history.jsonl 엔트리 (초 단위 ts, project 필드 없음)
export type CodexHistoryEntry = {
  session_id: string;
  ts: number;
  text: string;
};

// Codex 세션 파일 첫 줄 (session_meta)
export type CodexSessionMeta = {
  type: "session_meta";
  payload: {
    id: string;
    timestamp: string;
    cwd: string;
    git?: {
      branch?: string;
      commit_hash?: string;
      repository_url?: string;
    };
  };
};

// 세션 로그 메시지
export type SessionMessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown };

export type SessionMessage = {
  type: string;
  message?: {
    role: "user" | "assistant" | "system";
    content: string | SessionMessageContent[];
  };
};

// 세션 인덱스 (history.jsonl에서 추출)
export type SessionIndex = {
  source: SessionSource;
  projectPath: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  messageCount: number;
};

// 프로젝트별 그룹
export type ProjectGroup = {
  projectName: string;
  mainRepoPath: string;
  sessions: SessionIndex[];
  gitLog: string;
};

// 수집된 전체 데이터
export type CollectedData = {
  date: Date;
  projects: ProjectGroup[];
  sessionContents: Map<string, string>; // sessionId → 대화 텍스트 (user/assistant만)
};

// 태스크 (구조화 결과)
export type Task = {
  title: string;
  project: string;
  timeRange: { start: string; end: string };
  problem: string;
  cause: string;
  solution: string;
  result: string;
  lesson: string;
};

// 저장 결과
export type SaveResult = {
  dailyPath: string;
  projectPaths: string[];
  dailyOverwritten: boolean;
};
