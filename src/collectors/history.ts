import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { HistoryEntry, SessionIndex } from "../types/index.js";
import { CLAUDE_DIR } from "../utils/path.js";

const HISTORY_PATH = join(CLAUDE_DIR, "history.jsonl");

/**
 * history.jsonl에서 날짜 범위의 세션을 인덱싱한다.
 * 스트림 기반으로 1회 읽기하여 대용량 파일에서도 메모리 효율적.
 */
export async function indexSessionsInRange(startDate: Date, endDate: Date): Promise<SessionIndex[]> {
  if (!existsSync(HISTORY_PATH)) {
    return [];
  }

  const rangeStart = new Date(startDate);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  const sessionMap = new Map<string, { projectPath: string; timestamps: number[] }>();

  const rl = createInterface({
    input: createReadStream(HISTORY_PATH, "utf-8"),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: HistoryEntry;
    try {
      entry = JSON.parse(line) as HistoryEntry;
    } catch {
      continue;
    }

    const entryDate = new Date(entry.timestamp);
    if (entryDate < rangeStart || entryDate > rangeEnd) continue;

    const key = `${entry.project}::${entry.sessionId}`;
    const existing = sessionMap.get(key);

    if (existing) {
      existing.timestamps.push(entry.timestamp);
    } else {
      sessionMap.set(key, {
        projectPath: entry.project,
        timestamps: [entry.timestamp],
      });
    }
  }

  const sessions: SessionIndex[] = [];

  for (const [key, data] of sessionMap) {
    const sessionId = key.split("::")[1];
    const sorted = data.timestamps.sort((a, b) => a - b);

    sessions.push({
      projectPath: data.projectPath,
      sessionId,
      startTime: sorted[0],
      endTime: sorted[sorted.length - 1],
      messageCount: sorted.length,
    });
  }

  return sessions.sort((a, b) => a.startTime - b.startTime);
}

/**
 * 특정 날짜 하루의 세션을 인덱싱한다.
 * indexSessionsInRange에 위임.
 */
export async function indexTodaySessions(date: Date): Promise<SessionIndex[]> {
  return indexSessionsInRange(date, date);
}
