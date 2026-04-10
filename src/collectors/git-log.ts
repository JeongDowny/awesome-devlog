import { spawn } from "node:child_process";
import { isGitRepo } from "../utils/path.js";

/**
 * 특정 repo에서 날짜 범위의 git log를 비동기로 수집한다.
 * endDate를 생략하면 startDate 하루만 조회.
 */
export function collectGitLog(repoPath: string, startDate: Date, endDate?: Date): Promise<string> {
  if (!isGitRepo(repoPath)) {
    return Promise.resolve("");
  }

  const dateStr = formatDateForGit(startDate);
  const nextDateStr = formatDateForGit(nextDay(endDate ?? startDate));

  return new Promise((resolve) => {
    const child = spawn(
      "git",
      ["log", `--since=${dateStr}`, `--until=${nextDateStr}`, "--pretty=format:%h %s (%ai)", "--no-merges"],
      { cwd: repoPath },
    );

    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve("");
    }, 10_000);

    child.stdout.on("data", (data: Buffer) => {
      chunks.push(data);
    });

    child.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8").trim());
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

function formatDateForGit(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nextDay(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}
