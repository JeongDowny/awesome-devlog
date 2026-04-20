import { confirm, isCancel, log, spinner, text } from "@clack/prompts";
import { suggestLessons } from "../analyzer/structurize.js";
import type { Task } from "../types/index.js";
import { startProgressTicker } from "../utils/progress.js";

const QUESTION_TAG_REGEX = /\[질문 필요: ([^\]]+)\]/g;
const MAX_QUESTIONS_PER_TASK = 5;

type PendingQuestion = {
  taskIndex: number;
  taskTitle: string;
  field: keyof Task;
  question: string;
  tag: string;
};

/**
 * 태스크의 모든 필드에서 [질문 필요: ...] 태그를 파싱한다.
 */
function extractQuestions(tasks: Task[]): PendingQuestion[] {
  const questions: PendingQuestion[] = [];
  const targetFields: (keyof Task)[] = ["problem", "cause", "solution", "result"];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    let countForTask = 0;

    for (const field of targetFields) {
      if (countForTask >= MAX_QUESTIONS_PER_TASK) break;

      const value = task[field];
      if (typeof value !== "string") continue;

      QUESTION_TAG_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null = QUESTION_TAG_REGEX.exec(value);

      while (match !== null && countForTask < MAX_QUESTIONS_PER_TASK) {
        questions.push({
          taskIndex: i,
          taskTitle: task.title,
          field,
          question: match[1],
          tag: match[0],
        });
        countForTask++;
        match = QUESTION_TAG_REGEX.exec(value);
      }
    }
  }

  return questions;
}

/**
 * 인터랙티브 질문으로 태스크 맥락을 보완한다.
 */
export async function runInteractiveSession(tasks: Task[]): Promise<{ tasks: Task[]; cancelled: boolean }> {
  // 1. Claude Code 외 작업 질문
  const extraWork = await text({
    message: "Claude Code 외에 오늘 한 작업이 있어요? (없으면 Enter)",
    placeholder: "예: 코드 리뷰 피드백 반영, 배포 모니터링",
    defaultValue: "",
  });

  if (isCancel(extraWork)) {
    return { tasks, cancelled: true };
  }

  // 추가 작업이 있으면 태스크로 추가
  if (extraWork?.trim()) {
    const extraTasks = (extraWork as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const extra of extraTasks) {
      tasks.push({
        title: extra,
        project: "기타",
        timeRange: { start: "", end: "" },
        problem: extra,
        cause: "",
        solution: "",
        result: "",
        lesson: "",
      });
    }
  }

  // 2. 모든 태스크에서 [질문 필요: ...] 태그 파싱 후 질문
  const pendingQuestions = extractQuestions(tasks);

  if (pendingQuestions.length > 0) {
    log.info(`${pendingQuestions.length}개 항목에 대해 질문할게요.`);

    for (const pq of pendingQuestions) {
      const fieldLabel = getFieldLabel(pq.field);
      const answer = await text({
        message: `"${pq.taskTitle}" [${fieldLabel}] ${pq.question}`,
        placeholder: "한 줄로 간단하게 (건너뛰려면 Enter)",
        defaultValue: "",
      });

      if (isCancel(answer)) {
        return { tasks, cancelled: true };
      }

      const task = tasks[pq.taskIndex];
      const currentValue = task[pq.field] as string;

      if (answer && (answer as string).trim()) {
        // 태그를 답변으로 대체
        task[pq.field] = currentValue.replace(pq.tag, answer as string).trim();
      } else {
        // 답변 없으면 태그 제거
        task[pq.field] = currentValue.replace(pq.tag, "").trim();
      }
    }
  }

  // 3. 배운 점 질문
  const lessonInput = await text({
    message: "오늘 배운 점이 있어요? (없으면 Enter)",
    placeholder: "한 줄로 간단하게",
    defaultValue: "",
  });

  if (isCancel(lessonInput)) {
    return { tasks, cancelled: true };
  }

  if (lessonInput && (lessonInput as string).trim()) {
    // 사용자가 직접 입력한 배운 점을 첫 번째 태스크에 할당
    if (tasks.length > 0) {
      tasks[0].lesson = lessonInput as string;
    }
  } else {
    // AI가 배운 점 제안
    const mainTasks = tasks.filter((t) => t.problem && t.solution);
    if (mainTasks.length > 0) {
      const s = spinner();
      s.start("배운 점을 제안받는 중...");
      let lessonState = { lessonCount: 0, chars: 0 };
      const stopTicker = startProgressTicker(s, () => {
        if (lessonState.lessonCount > 0) {
          return `배운 점을 제안받는 중... ${lessonState.lessonCount}개 수신`;
        }
        return "배운 점을 제안받는 중...";
      });

      try {
        const suggestions = await suggestLessons(mainTasks, (state) => {
          lessonState = state;
        });
        stopTicker();
        s.stop(`${suggestions.length}개 제안 받음`);

        for (let i = 0; i < Math.min(suggestions.length, mainTasks.length); i++) {
          log.info(`배운 점 제안 (${mainTasks[i].title}): "${suggestions[i]}"`);

          const accepted = await confirm({
            message: "이 배운 점을 포함할까요?",
          });

          if (isCancel(accepted)) {
            return { tasks, cancelled: true };
          }

          if (accepted) {
            mainTasks[i].lesson = suggestions[i];
          }
        }
      } catch {
        stopTicker();
        s.stop("배운 점 제안 실패");
        log.warn("배운 점 제안 생성에 실패했어요. 건너뛸게요.");
      }
    }
  }

  return { tasks, cancelled: false };
}

function getFieldLabel(field: keyof Task): string {
  const labels: Record<string, string> = {
    problem: "문제",
    cause: "원인",
    solution: "해결",
    result: "결과",
  };
  return labels[field] ?? field;
}
