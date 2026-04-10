import type { CollectedData, Task } from "../types/index.js";
import { askClaude } from "../utils/claude.js";

const SYSTEM_PROMPT = `당신은 개발자의 하루 작업을 분석하여 데브로그를 구조화하는 도우미입니다.

주어진 데이터:
- Claude Code 대화 로그 (사용자 질문 + Claude 응답)
- git commit 이력

이 데이터를 분석하여 태스크 단위로 분리하고, 각 태스크를 다음 구조로 정리하세요:

1. **제목**: 태스크를 한 줄로 요약
2. **프로젝트**: 프로젝트 이름
3. **시간**: 시작 ~ 종료 시간 (HH:MM 형식)
4. **문제**: 어떤 문제나 요구사항이 있었는지
5. **원인**: 문제의 원인이 무엇이었는지 (분석 가능한 경우)
6. **해결**: 어떻게 해결했는지
7. **결과**: 해결 후 어떤 결과가 나왔는지

규칙:
- "배운 점"은 비워두세요. 사용자가 직접 채울 거예요.
- 한국어로 작성하세요.
- 간단한 작업(오타 수정, 설정 변경 등)은 하나로 묶어도 괜찮아요.
- 반드시 JSON 배열만 응답하세요. 다른 텍스트는 포함하지 마세요.

질문 태그 규칙:
- 로그에서 확인할 수 없거나 모호한 부분이 있으면, 해당 필드에 [질문 필요: 구체적 질문] 태그를 넣으세요.
- 문제, 원인, 해결, 결과 모든 필드에 사용 가능합니다.
- 확실한 내용과 함께 태그를 섞어 쓸 수 있습니다.
- 예시:
  - "원인": "Tailwind CSS 호환성 문제로 추정되지만 [질문 필요: 정확히 어떤 속성이 문제였나요?]"
  - "해결": "[질문 필요: 어떤 방식으로 해결했나요?]"
  - "결과": "배포 완료 [질문 필요: 배포 후 모니터링 결과는 어땠나요?]"
- 적극적으로 질문하세요. 로그에서 명확히 확인되지 않는 부분은 추측보다 질문이 낫습니다.`;

const RESPONSE_FORMAT = `응답 형식 (순수 JSON 배열만, 마크다운 코드블록 없이):
[
  {
    "title": "태스크 제목",
    "project": "프로젝트명",
    "timeRange": { "start": "HH:MM", "end": "HH:MM" },
    "problem": "문제 설명",
    "cause": "원인 분석",
    "solution": "해결 방법",
    "result": "결과",
    "lesson": ""
  }
]`;

const MAX_PROMPT_CHARS = 300_000; // ~150K 토큰, claude 컨텍스트 한도 내

/**
 * 수집된 데이터를 Claude Code로 분석하여 태스크 단위로 구조화한다.
 * 프롬프트가 너무 크면 데이터를 잘라서 전달한다.
 */
export async function structurizeTasks(data: CollectedData): Promise<Task[]> {
  const userMessage = buildUserMessage(data);
  const baseLength = SYSTEM_PROMPT.length + RESPONSE_FORMAT.length + 50;
  const availableChars = MAX_PROMPT_CHARS - baseLength;

  const trimmedMessage =
    userMessage.length > availableChars
      ? `${userMessage.slice(0, availableChars)}\n\n... (데이터가 너무 길어 일부만 포함)`
      : userMessage;

  const prompt = `${SYSTEM_PROMPT}\n\n---\n\n${trimmedMessage}\n\n${RESPONSE_FORMAT}`;

  const response = await askClaude(prompt);
  return parseTasksFromResponse(response);
}

/**
 * 배운 점을 제안하기 위한 Claude Code 호출
 */
export async function suggestLessons(tasks: Task[]): Promise<string[]> {
  const taskSummary = tasks
    .map((t, i) => `${i + 1}. ${t.title}\n   문제: ${t.problem}\n   해결: ${t.solution}\n   결과: ${t.result}`)
    .join("\n\n");

  const prompt = `다음 개발 작업들에서 배울 수 있는 점을 태스크별로 한 줄씩 제안해줘. 실무적이고 구체적으로.

${taskSummary}

순수 JSON 배열만 응답해줘 (마크다운 코드블록 없이): ["배운 점 1", "배운 점 2", ...]`;

  const response = await askClaude(prompt);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as string[];
  } catch {
    return [];
  }
}

/**
 * 마크다운 초안을 사용자 지시에 따라 수정한다.
 */
export async function reviseMarkdown(currentMarkdown: string, userPrompt: string): Promise<string> {
  const prompt = `당신은 개발 데브로그 편집자입니다. 아래 마크다운 초안을 사용자의 수정 지시에 따라 수정해주세요.

수정 지시: ${userPrompt}

현재 초안:
${currentMarkdown}

규칙:
- 수정된 전체 마크다운만 응답하세요. 설명이나 코드블록 없이 마크다운 원문만.
- 지시받지 않은 부분은 그대로 유지하세요.
- 한국어로 작성하세요.`;

  return askClaude(prompt);
}

/**
 * 새 태스크들을 기존 프로젝트 파일 목록과 비교하여 매칭한다.
 * 같은 작업이면 기존 파일명, 새 작업이면 null을 반환.
 * 기존 파일이 없으면 Claude 호출 없이 전부 null.
 */
export async function matchTasksToFiles(
  taskTitles: string[],
  existingFiles: string[],
): Promise<Map<number, string | null>> {
  const result = new Map<number, string | null>();

  if (existingFiles.length === 0) {
    for (let i = 0; i < taskTitles.length; i++) {
      result.set(i, null);
    }
    return result;
  }

  const prompt = `기존 프로젝트 일지 파일 목록과 새 태스크 목록을 비교해서, 같은 작업에 해당하면 기존 파일명을, 새 작업이면 null을 반환해줘.

기존 파일:
${existingFiles.map((f, i) => `${i + 1}. ${f}`).join("\n")}

새 태스크:
${taskTitles.map((t, i) => `${i}. ${t}`).join("\n")}

판단 기준:
- 제목이 완전히 같지 않아도, 같은 기능·이슈·작업에 대한 것이면 매칭
- 예: "로그인 버그 수정" ↔ "카카오 로그인 오류 해결" → 같은 작업
- 확실하지 않으면 null (새 파일)로 판단

순수 JSON만 응답 (마크다운 코드블록 없이):
{"0": "기존파일명.md", "1": null, ...}`;

  try {
    const response = await askClaude(prompt);
    const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "");
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      for (let i = 0; i < taskTitles.length; i++) result.set(i, null);
      return result;
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string | null>;
    for (let i = 0; i < taskTitles.length; i++) {
      const value = parsed[String(i)];
      result.set(i, value && existingFiles.includes(value) ? value : null);
    }
  } catch {
    for (let i = 0; i < taskTitles.length; i++) result.set(i, null);
  }

  return result;
}

function buildUserMessage(data: CollectedData): string {
  const parts: string[] = [];

  for (const project of data.projects) {
    parts.push(`## 프로젝트: ${project.projectName}`);

    if (project.gitLog) {
      parts.push(`### Git 커밋 이력\n${project.gitLog}`);
    }

    for (const session of project.sessions) {
      const content = data.sessionContents.get(session.sessionId);
      if (content) {
        const startTime = new Date(session.startTime).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const endTime = new Date(session.endTime).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        parts.push(`### 세션 (${startTime} ~ ${endTime})\n${content}`);
      }
    }

    parts.push("");
  }

  return parts.join("\n\n");
}

function parseTasksFromResponse(text: string): Task[] {
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "");
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Claude 응답에서 JSON을 파싱할 수 없어요. 다시 시도해주세요.");
  }

  let parsed: Task[];
  try {
    parsed = JSON.parse(jsonMatch[0]) as Task[];
  } catch {
    throw new Error("Claude 응답이 유효한 JSON이 아니에요. 다시 시도해주세요.");
  }

  return parsed.map((task) => ({
    title: task.title || "제목 없음",
    project: task.project || "알 수 없음",
    timeRange: task.timeRange || { start: "00:00", end: "00:00" },
    problem: task.problem || "",
    cause: task.cause || "",
    solution: task.solution || "",
    result: task.result || "",
    lesson: "",
  }));
}
