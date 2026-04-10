import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "../types/index.js";

/**
 * Task 배열을 메타데이터 헤더 포함 마크다운 문자열로 렌더링한다.
 */
export function renderMarkdown(tasks: Task[], date: Date, selectedDates: string[]): string {
  const dateStr = formatDate(date);
  const now = new Date();
  const createdAt = `${formatDate(now)} ${formatTime(now)}`;

  const lines: string[] = [`# ${dateStr}`, ""];

  // 메타데이터 헤더
  lines.push(`> **반영 날짜**: ${selectedDates.join(", ")}`);
  lines.push(`> **프로젝트**: ${buildProjectSummary(tasks)}`);
  lines.push(`> **작성 시각**: ${createdAt}`);
  lines.push("");

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const num = i + 1;

    lines.push(`## 태스크 ${num}. ${task.title}`);
    lines.push(`**프로젝트**: ${task.project}`);

    if (task.timeRange.start || task.timeRange.end) {
      lines.push(`**시간**: ${task.timeRange.start} ~ ${task.timeRange.end}`);
    }

    lines.push("");
    appendTaskBody(lines, task);

    if (i < tasks.length - 1) {
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * 시간순 RAW 일지를 저장한다.
 * 파일명: <outputDir>/daily/YYYY-MM-DD_HHmm.md
 */
export function saveDailyLog(content: string, outputDir: string): { filePath: string; overwritten: boolean } {
  const dailyDir = join(outputDir, "daily");
  ensureDir(dailyDir);

  const now = new Date();
  const fileName = `${formatDate(now)}_${formatTimeCompact(now)}.md`;
  const filePath = join(dailyDir, fileName);
  const overwritten = existsSync(filePath);

  writeFileSafe(filePath, content);
  return { filePath, overwritten };
}

/**
 * 프로젝트별 일지를 저장한다.
 * 기존 파일이면 append, 새 파일이면 생성.
 */
export function saveProjectLogs(
  tasks: Task[],
  selectedDates: string[],
  outputDir: string,
  taskFileMap: Map<number, string | null>,
): string[] {
  const projectsDir = join(outputDir, "projects");
  const savedPaths: string[] = [];
  const dateLabel = selectedDates[selectedDates.length - 1];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (task.project === "기타") continue;

    const projectDir = join(projectsDir, sanitizeFileName(task.project));
    ensureDir(projectDir);

    const matchedFile = taskFileMap.get(i);

    if (matchedFile) {
      // 기존 파일에 append
      const filePath = join(projectDir, matchedFile);
      const appendContent = buildAppendContent(task, dateLabel);
      appendFileSync(filePath, appendContent, "utf-8");
      savedPaths.push(filePath);
    } else {
      // 새 파일 생성
      const fileName = `${sanitizeFileName(task.title)}.md`;
      const filePath = join(projectDir, fileName);
      const content = buildNewProjectFile(task, dateLabel);
      writeFileSafe(filePath, content);
      savedPaths.push(filePath);
    }
  }

  return savedPaths;
}

/**
 * 프로젝트 디렉터리의 기존 .md 파일 목록을 반환한다.
 */
export function listProjectFiles(outputDir: string, projectName: string): string[] {
  const projectDir = join(outputDir, "projects", sanitizeFileName(projectName));
  if (!existsSync(projectDir)) return [];

  try {
    return readdirSync(projectDir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

// --- 내부 헬퍼 ---

function buildProjectSummary(tasks: Task[]): string {
  const projectTimes = new Map<string, number>();

  for (const task of tasks) {
    const minutes = calcMinutes(task.timeRange.start, task.timeRange.end);
    const current = projectTimes.get(task.project) ?? 0;
    projectTimes.set(task.project, current + minutes);
  }

  return Array.from(projectTimes.entries())
    .map(([name, minutes]) => `${name} (${formatDuration(minutes)})`)
    .join(", ");
}

function calcMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) return 0;
  const diff = eh * 60 + em - (sh * 60 + sm);
  return Math.max(0, diff);
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "시간 미상";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function appendTaskBody(lines: string[], task: Task): void {
  if (task.problem) {
    lines.push("### 문제");
    lines.push(task.problem);
    lines.push("");
  }

  if (task.cause && !task.cause.includes("[질문 필요")) {
    lines.push("### 원인");
    lines.push(task.cause);
    lines.push("");
  }

  if (task.solution) {
    lines.push("### 해결");
    lines.push(task.solution);
    lines.push("");
  }

  if (task.result) {
    lines.push("### 결과");
    lines.push(task.result);
    lines.push("");
  }

  if (task.lesson) {
    lines.push("### 배운 점");
    lines.push(task.lesson);
    lines.push("");
  }
}

function buildNewProjectFile(task: Task, dateLabel: string): string {
  const lines: string[] = [`# ${task.title}`, ""];
  lines.push(`## ${dateLabel}`);

  if (task.timeRange.start || task.timeRange.end) {
    lines.push(`**시간**: ${task.timeRange.start} ~ ${task.timeRange.end}`);
  }
  lines.push("");

  appendTaskBody(lines, task);
  return lines.join("\n");
}

function buildAppendContent(task: Task, dateLabel: string): string {
  const lines: string[] = ["", "---", "", `## ${dateLabel}`];

  if (task.timeRange.start || task.timeRange.end) {
    lines.push(`**시간**: ${task.timeRange.start} ~ ${task.timeRange.end}`);
  }
  lines.push("");

  appendTaskBody(lines, task);
  return lines.join("\n");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim();
}

function ensureDir(dir: string): void {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch {
    throw new Error(`디렉터리를 생성할 수 없어요: ${dir}`);
  }
}

function writeFileSafe(filePath: string, content: string): void {
  try {
    writeFileSync(filePath, content, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("EACCES")) {
      throw new Error(`쓰기 권한이 없어요: ${filePath}`);
    }
    throw new Error(`파일을 저장할 수 없어요: ${message}`);
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function formatTimeCompact(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}${m}`;
}
