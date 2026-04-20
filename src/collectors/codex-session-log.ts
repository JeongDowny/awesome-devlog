import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { CodexHistoryEntry, CodexSessionMeta, SessionIndex } from "../types/index.js";
import { CODEX_HISTORY_PATH, CODEX_SESSIONS_DIR } from "../utils/path.js";

const MAX_CHARS_PER_SESSION = 60_000; // ~30K 토큰

// Codex 세션 파일명에서 UUID v7(8-4-4-4-12)을 추출하는 정규식
// 예: rollout-2026-04-20T12-41-10-019da8fa-50a1-7c02-b3c9-4022f552873d.jsonl
const SESSION_FILE_UUID_REGEX = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

// Codex가 사용자 메시지 앞부분에 주입하는 시스템 태그들 — 대화로 취급하지 않음
const SYSTEM_INJECTED_PREFIXES = [
  "<environment_context>",
  "<permissions instructions>",
  "<collaboration_mode>",
  "<apps_instructions>",
  "<skills_instructions>",
];

// 모듈 레벨 캐시: collectCodexSessionLog가 여러 번 호출될 때 전체 스캔 반복을 피함
let codexFileIndexCache: Map<string, string> | null = null;

/**
 * Codex history.jsonl에서 범위 내 세션을 인덱싱한다.
 * Codex history.jsonl은 project 필드가 없어서 각 세션의 cwd는 세션 파일 첫 줄(session_meta)에서 얻는다.
 */
export async function indexCodexSessionsInRange(startDate: Date, endDate: Date): Promise<SessionIndex[]> {
  if (!existsSync(CODEX_HISTORY_PATH) || !existsSync(CODEX_SESSIONS_DIR)) {
    return [];
  }

  const rangeStart = new Date(startDate);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  const sessionMap = new Map<string, { timestamps: number[] }>();

  const rl = createInterface({
    input: createReadStream(CODEX_HISTORY_PATH, "utf-8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: CodexHistoryEntry;
    try {
      entry = JSON.parse(line) as CodexHistoryEntry;
    } catch {
      continue;
    }

    if (typeof entry.session_id !== "string" || typeof entry.ts !== "number") {
      continue;
    }

    // Codex ts는 초 단위 → ms 변환
    const timestampMs = entry.ts * 1000;
    const entryDate = new Date(timestampMs);
    if (entryDate < rangeStart || entryDate > rangeEnd) continue;

    const existing = sessionMap.get(entry.session_id);
    if (existing) {
      existing.timestamps.push(timestampMs);
    } else {
      sessionMap.set(entry.session_id, { timestamps: [timestampMs] });
    }
  }

  if (sessionMap.size === 0) {
    return [];
  }

  const fileIndex = getCodexSessionFileIndex();
  const sessions: SessionIndex[] = [];

  for (const [sessionId, data] of sessionMap) {
    const filePath = fileIndex.get(sessionId);
    if (!filePath) continue;

    const meta = readCodexSessionMeta(filePath);
    if (!meta) continue;

    const sorted = data.timestamps.sort((a, b) => a - b);

    sessions.push({
      source: "codex",
      projectPath: meta.payload.cwd,
      sessionId,
      startTime: sorted[0],
      endTime: sorted[sorted.length - 1],
      messageCount: sorted.length,
    });
  }

  return sessions.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Codex 세션 파일에서 user/assistant 메시지를 추출한다.
 * - developer role과 시스템 주입 태그로 시작하는 user 메시지는 제외
 */
export function collectCodexSessionLog(sessionId: string): string | null {
  const fileIndex = getCodexSessionFileIndex();
  const filePath = fileIndex.get(sessionId);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.trim().split("\n").filter(Boolean);
  const messages: string[] = [];

  for (const line of lines) {
    let event: { type?: string; payload?: unknown };
    try {
      event = JSON.parse(line) as { type?: string; payload?: unknown };
    } catch {
      continue;
    }

    if (event.type !== "response_item") continue;

    const payload = event.payload;
    if (!payload || typeof payload !== "object") continue;

    const p = payload as Record<string, unknown>;
    if (p.type !== "message") continue;

    const role = typeof p.role === "string" ? p.role : "";
    if (role !== "user" && role !== "assistant") continue;

    const content = p.content;
    if (!Array.isArray(content)) continue;

    const text = extractCodexText(content);
    if (!text) continue;

    // Codex가 매 턴 주입하는 환경/권한/모드/앱/스킬 브리핑은 대화가 아니므로 제외
    if (role === "user" && isSystemInjectedUserMessage(text)) continue;

    const label = role === "user" ? "[사용자]" : "[Codex]";
    messages.push(`${label}: ${cleanCodexText(text)}`);
  }

  if (messages.length === 0) {
    return null;
  }

  const fullText = messages.join("\n\n");
  if (fullText.length > MAX_CHARS_PER_SESSION) {
    return `${fullText.slice(0, MAX_CHARS_PER_SESSION)}\n\n... (세션 로그가 너무 길어서 잘렸어요)`;
  }

  return fullText;
}

function extractCodexText(content: unknown[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const typed = item as { type?: string; text?: string };
    if ((typed.type === "input_text" || typed.type === "output_text") && typeof typed.text === "string") {
      parts.push(typed.text);
    }
  }
  return parts.join("\n").trim();
}

function isSystemInjectedUserMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return SYSTEM_INJECTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function cleanCodexText(text: string): string {
  return text
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, "")
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/g, "")
    .replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/g, "")
    .replace(/<apps_instructions>[\s\S]*?<\/apps_instructions>/g, "")
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/g, "")
    .trim();
}

function readCodexSessionMeta(filePath: string): CodexSessionMeta | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const newlineIdx = raw.indexOf("\n");
    const firstLine = newlineIdx >= 0 ? raw.slice(0, newlineIdx) : raw;
    if (!firstLine) return null;

    const parsed = JSON.parse(firstLine) as CodexSessionMeta;
    if (parsed.type !== "session_meta") return null;
    if (!parsed.payload || typeof parsed.payload.cwd !== "string") return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * sessionId → 파일 경로 맵 (캐시).
 * Codex는 날짜별 디렉터리 트리라 전체 스캔해도 수백~수천 파일 수준이라 실용 범위.
 */
function getCodexSessionFileIndex(): Map<string, string> {
  if (codexFileIndexCache) return codexFileIndexCache;
  const index = new Map<string, string>();

  if (!existsSync(CODEX_SESSIONS_DIR)) {
    codexFileIndexCache = index;
    return index;
  }

  for (const year of safeReaddir(CODEX_SESSIONS_DIR)) {
    const yearDir = join(CODEX_SESSIONS_DIR, year);
    for (const month of safeReaddir(yearDir)) {
      const monthDir = join(yearDir, month);
      for (const day of safeReaddir(monthDir)) {
        const dayDir = join(monthDir, day);
        for (const file of safeReaddir(dayDir)) {
          const match = file.match(SESSION_FILE_UUID_REGEX);
          if (!match) continue;
          index.set(match[1], join(dayDir, file));
        }
      }
    }
  }

  codexFileIndexCache = index;
  return index;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
