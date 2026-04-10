import { existsSync, readFileSync } from "node:fs";
import type { SessionMessage } from "../types/index.js";
import { findSessionLogPath } from "../utils/path.js";

const MAX_CHARS_PER_SESSION = 60_000; // ~30K 토큰 (한국어+영어 혼합 기준 약 2글자/토큰)

/**
 * 세션 로그 JSONL에서 user/assistant 텍스트만 추출한다.
 * tool_result의 긴 코드 출력은 제거하고, 핵심 대화만 남긴다.
 */
export function collectSessionLog(projectPath: string, sessionId: string): string | null {
  const logPath = findSessionLogPath(projectPath, sessionId);
  if (!logPath || !existsSync(logPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(logPath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.trim().split("\n").filter(Boolean);
  const messages: string[] = [];

  for (const line of lines) {
    let entry: SessionMessage;
    try {
      entry = JSON.parse(line) as SessionMessage;
    } catch {
      continue; // 손상된 라인 건너뛰기
    }

    if (!entry.message) continue;
    if (entry.type === "system" || entry.type === "file-history-snapshot") continue;

    const { role, content } = entry.message;

    if (role === "user") {
      const text = extractText(content);
      if (text) {
        messages.push(`[사용자]: ${text}`);
      }
    } else if (role === "assistant") {
      const text = extractText(content);
      if (text) {
        messages.push(`[Claude]: ${text}`);
      }
    }
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

function extractText(content: string | unknown[]): string {
  if (typeof content === "string") {
    return cleanText(content);
  }

  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (typeof item === "object" && item !== null && "type" in item) {
        const typed = item as { type: string; text?: string };
        if (typed.type === "text" && typed.text) {
          texts.push(typed.text);
        }
      }
    }
    return cleanText(texts.join("\n"));
  }

  return "";
}

function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .trim();
}
