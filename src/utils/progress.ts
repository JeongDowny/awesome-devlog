import type { spinner } from "@clack/prompts";

type Spinner = ReturnType<typeof spinner>;

/**
 * spinner 메시지에 경과 시간을 주기적으로 덧붙여 갱신한다.
 * getMessage()는 호출 시점의 상태(태스크 수, 수신 크기 등)를 읽어 기본 메시지를 만든다.
 * 반환되는 함수를 호출하면 업데이트를 멈춘다.
 */
export function startProgressTicker(s: Spinner, getMessage: () => string, intervalMs = 500): () => void {
  const startTime = Date.now();

  const render = (): void => {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSec / 60);
    const seconds = elapsedSec % 60;
    const timeStr = minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
    s.message(`${getMessage()} (경과 ${timeStr})`);
  };

  render();
  const interval = setInterval(render, intervalMs);
  return (): void => clearInterval(interval);
}
