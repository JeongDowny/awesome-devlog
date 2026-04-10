import { spawn } from "node:child_process";

const TIMEOUT_MS = 300_000; // 5분

/**
 * claude -p (비대화형 모드)로 프롬프트를 실행한다.
 * Claude Code의 인증을 그대로 사용하므로 별도 API 키가 필요 없다.
 */
export function askClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"]);

    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude Code 응답 시간이 초과되었어요 (5분). 세션 수를 줄여서 다시 시도해주세요."));
    }, TIMEOUT_MS);

    child.stdout.on("data", (data: Buffer) => {
      chunks.push(data);
    });

    child.stderr.on("data", (data: Buffer) => {
      errorChunks.push(data);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf-8").trim();
      const errorOutput = Buffer.concat(errorChunks).toString("utf-8").trim();

      if (code !== 0) {
        reject(new Error(errorOutput || `Claude Code가 비정상 종료되었어요 (코드: ${code}).`));
        return;
      }

      if (!output) {
        reject(new Error("Claude Code가 빈 응답을 반환했어요. 다시 시도해주세요."));
        return;
      }

      resolve(output);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new Error("Claude Code CLI가 설치되지 않았어요. https://docs.anthropic.com/claude-code 를 참고해주세요."),
        );
      } else {
        reject(new Error(`Claude Code 실행 실패: ${err.message}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
