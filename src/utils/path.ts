import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

/**
 * 프로젝트 절대 경로를 Claude Code 디렉터리명으로 변환
 * Claude Code는 / 와 _ 를 모두 - 로 치환한다.
 * /Users/foo/bar_baz → -Users-foo-bar-baz
 */
export function projectPathToDir(projectPath: string): string {
  return projectPath.replace(/[/_]/g, "-");
}

/**
 * 이전 버전 호환: _ 를 유지하는 레거시 변환
 * /Users/foo/bar_baz → -Users-foo-bar_baz
 */
function projectPathToDirLegacy(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

/**
 * 워크트리 경로에서 메인 repo 경로를 역추적
 * /path/.01_dnd-worktrees/video-upload → /path/01_dnd
 */
export function resolveWorktreeToMain(projectPath: string): string {
  // worktrees 패턴 감지: /.xxx-worktrees/branch-name
  const worktreeMatch = projectPath.match(/^(.+)\/(\.([^/]+)-worktrees)\/[^/]+$/);
  if (!worktreeMatch) {
    return projectPath;
  }

  const parentDir = worktreeMatch[1];
  const repoName = worktreeMatch[3]; // 앞의 . 제거된 이름

  return join(parentDir, repoName);
}

/**
 * 프로젝트 경로에서 사람이 읽을 수 있는 프로젝트 이름 추출
 */
export function extractProjectName(projectPath: string): string {
  const mainPath = resolveWorktreeToMain(projectPath);
  return basename(mainPath);
}

/**
 * sessionId로 세션 로그 JSONL 파일 경로 찾기
 * 현재 규칙(/_→-)을 먼저 시도하고, 없으면 레거시 규칙(/→-)으로 fallback
 */
export function findSessionLogPath(projectPath: string, sessionId: string): string | null {
  const fileName = `${sessionId}.jsonl`;

  const dirName = projectPathToDir(projectPath);
  const logPath = join(PROJECTS_DIR, dirName, fileName);
  if (existsSync(logPath)) {
    return logPath;
  }

  const legacyDirName = projectPathToDirLegacy(projectPath);
  if (legacyDirName !== dirName) {
    const legacyLogPath = join(PROJECTS_DIR, legacyDirName, fileName);
    if (existsSync(legacyLogPath)) {
      return legacyLogPath;
    }
  }

  return null;
}

/**
 * 프로젝트 경로가 워크트리인지 확인
 */
export function isWorktreePath(projectPath: string): boolean {
  return /-worktrees\//.test(projectPath);
}

/**
 * 메인 repo 경로에 .git 디렉터리가 있는지 확인
 */
export function isGitRepo(repoPath: string): boolean {
  return existsSync(join(repoPath, ".git"));
}

export { CLAUDE_DIR, PROJECTS_DIR };
