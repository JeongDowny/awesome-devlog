import { spawn } from "node:child_process";

const TIMEOUT_MS = 300_000; // 5분

export type ClaudeStreamOptions = {
  // 스트리밍 델타가 도착할 때마다 호출. accumulated는 지금까지 누적된 전체 텍스트.
  onDelta?: (delta: string, accumulated: string) => void;
};

/**
 * claude -p (비대화형 모드)로 프롬프트를 실행한다.
 * Claude Code의 인증을 그대로 사용하므로 별도 API 키가 필요 없다.
 *
 * onDelta 콜백을 전달하면 stream-json 포맷으로 실행되어 중간 응답을 콜백으로 전달한다.
 */
export function askClaude(prompt: string, options?: ClaudeStreamOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const useStream = Boolean(options?.onDelta);
    const args = useStream ? ["-p", "--output-format", "stream-json", "--verbose"] : ["-p", "--output-format", "text"];
    const child = spawn("claude", args);

    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    // 스트리밍 모드에서 개행 기준으로 JSON 이벤트를 파싱하기 위한 버퍼
    let lineBuffer = "";
    let accumulated = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude Code 응답 시간이 초과되었어요 (5분). 세션 수를 줄여서 다시 시도해주세요."));
    }, TIMEOUT_MS);

    child.stdout.on("data", (data: Buffer) => {
      chunks.push(data);

      if (!useStream || !options?.onDelta) return;

      lineBuffer += data.toString("utf-8");
      let newlineIndex = lineBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);

        if (line) {
          const delta = extractStreamDelta(line);
          if (delta) {
            accumulated += delta;
            options.onDelta(delta, accumulated);
          }
        }
        newlineIndex = lineBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      errorChunks.push(data);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const errorOutput = Buffer.concat(errorChunks).toString("utf-8").trim();

      if (code !== 0) {
        reject(new Error(errorOutput || `Claude Code가 비정상 종료되었어요 (코드: ${code}).`));
        return;
      }

      if (useStream) {
        // stream-json 모드: result 이벤트의 최종 텍스트 우선, 없으면 누적 텍스트
        const rawOutput = Buffer.concat(chunks).toString("utf-8");
        const finalResult = extractFinalResult(rawOutput);
        const output = (finalResult ?? accumulated).trim();

        if (!output) {
          reject(new Error("Claude Code가 빈 응답을 반환했어요. 다시 시도해주세요."));
          return;
        }
        resolve(output);
        return;
      }

      const output = Buffer.concat(chunks).toString("utf-8").trim();
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

/**
 * stream-json 한 줄에서 텍스트 델타를 추출한다.
 * Claude Code CLI의 이벤트 포맷이 버전마다 달라질 수 있어 방어적으로 파싱한다.
 */
function extractStreamDelta(line: string): string | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;

  // assistant 이벤트: message.content[].text
  if (e.type === "assistant" && e.message && typeof e.message === "object") {
    const message = e.message as Record<string, unknown>;
    const content = message.content;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const block of content) {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            texts.push(b.text);
          }
        }
      }
      return texts.join("") || null;
    }
  }

  // content_block_delta 이벤트 (--include-partial-messages 가 켜진 경우)
  if (e.type === "content_block_delta" && e.delta && typeof e.delta === "object") {
    const delta = e.delta as Record<string, unknown>;
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  return null;
}

/**
 * stream-json 전체 출력에서 마지막 result 이벤트의 최종 텍스트를 추출한다.
 */
function extractFinalResult(rawOutput: string): string | null {
  const lines = rawOutput.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event?.type === "result" && typeof event.result === "string") {
        return event.result;
      }
    } catch {
      // 파싱 실패한 줄은 건너뜀
    }
  }
  return null;
}
