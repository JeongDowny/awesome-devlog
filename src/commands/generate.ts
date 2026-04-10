import { intro, isCancel, log, multiselect, outro, select, spinner, text } from "@clack/prompts";
import { matchTasksToFiles, reviseMarkdown, structurizeTasks } from "../analyzer/structurize.js";
import { collectGitLog } from "../collectors/git-log.js";
import { indexSessionsInRange } from "../collectors/history.js";
import { collectSessionLog } from "../collectors/session-log.js";
import { loadConfig } from "../config/config.js";
import { runInteractiveSession } from "../interactive/questions.js";
import type { CollectedData, ProjectGroup, Task } from "../types/index.js";
import { extractProjectName, isGitRepo, resolveWorktreeToMain } from "../utils/path.js";
import { listProjectFiles, renderMarkdown, saveDailyLog, saveProjectLogs } from "../writer/markdown.js";

const DAYS_TO_SHOW = 7;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function formatDayLabel(date: Date, today: Date): string {
  const dateStr = formatDate(date);
  const todayStr = formatDate(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);
  const weekday = WEEKDAYS[date.getDay()];

  if (dateStr === todayStr) return `${dateStr} (${weekday}) — 오늘`;
  if (dateStr === yesterdayStr) return `${dateStr} (${weekday}) — 어제`;
  return `${dateStr} (${weekday})`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function runGenerate(): Promise<void> {
  intro("DevLog Automator");

  // 1. 설정 로드
  const config = loadConfig();
  if (!config) {
    log.error("설정이 없어요. 먼저 `devlog init`을 실행해주세요.");
    outro("");
    return;
  }

  const today = new Date();

  // 2. 날짜 선택 (최근 7일)
  const dateOptions = Array.from({ length: DAYS_TO_SHOW }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    return {
      value: formatDate(d),
      label: formatDayLabel(d, today),
    };
  });

  const selectedDates = await multiselect({
    message: "어떤 날짜의 데브로그를 작성할까요? (스페이스바로 선택/해제, Enter로 확인)",
    options: dateOptions,
    initialValues: [formatDate(today)],
  });

  if (isCancel(selectedDates)) {
    outro("취소되었어요.");
    return;
  }

  const selectedDateSet = new Set(selectedDates as string[]);

  if (selectedDateSet.size === 0) {
    outro("선택된 날짜가 없어요.");
    return;
  }

  // 3. 세션 인덱싱 (선택된 날짜의 최소~최대 범위를 1회 읽기)
  const sortedDates = [...selectedDateSet].sort();
  const rangeStart = new Date(sortedDates[0]);
  const rangeEnd = new Date(sortedDates[sortedDates.length - 1]);

  const rangeSessions = await indexSessionsInRange(rangeStart, rangeEnd);

  // 불연속 날짜 선택 대응: 선택된 날짜에 해당하는 세션만 필터링
  const allSessions = rangeSessions.filter((s) => {
    const sessionDate = formatDate(new Date(s.startTime));
    return selectedDateSet.has(sessionDate);
  });

  if (allSessions.length === 0) {
    outro("선택한 날짜에 Claude Code 세션이 없어요.");
    return;
  }

  log.info(`${sortedDates.length}일간 ${allSessions.length}개 세션을 찾았어요.`);

  // 데브로그 제목·파일명에 쓸 대표 날짜 (가장 최근 선택 날짜)
  const targetDate = new Date(sortedDates[sortedDates.length - 1]);

  // 4. 프로젝트 선택
  const projectSessionMap = new Map<string, { projectName: string; sessions: typeof allSessions }>();

  for (const session of allSessions) {
    const mainPath = resolveWorktreeToMain(session.projectPath);
    const existing = projectSessionMap.get(mainPath);
    if (existing) {
      existing.sessions.push(session);
    } else {
      projectSessionMap.set(mainPath, {
        projectName: extractProjectName(session.projectPath),
        sessions: [session],
      });
    }
  }

  const projectOptions = Array.from(projectSessionMap.entries()).map(
    ([mainPath, { projectName, sessions: projSessions }]) => ({
      value: mainPath,
      label: `${projectName}  (${projSessions.length}개 세션)`,
    }),
  );

  const allProjectKeys = projectOptions.map((o) => o.value);

  const selectedProjects = await multiselect({
    message: "어떤 프로젝트에 집중할까요? (스페이스바로 선택/해제, Enter로 확인)",
    options: projectOptions,
    initialValues: allProjectKeys,
  });

  if (isCancel(selectedProjects)) {
    outro("취소되었어요.");
    return;
  }

  const selectedProjectSet = new Set(selectedProjects as string[]);

  if (selectedProjectSet.size === 0) {
    outro("선택된 프로젝트가 없어요.");
    return;
  }

  // 5. 세션 선택 (선택된 프로젝트의 세션만 표시, 전체 pre-selected)
  const filteredSessions = allSessions.filter((s) => selectedProjectSet.has(resolveWorktreeToMain(s.projectPath)));

  const sessionOptions = filteredSessions.map((session) => {
    const projectName = extractProjectName(session.projectPath);
    const sessionDate = new Date(session.startTime);
    const dateLabel = formatDate(sessionDate);
    const weekday = WEEKDAYS[sessionDate.getDay()];
    const start = formatTime(session.startTime);
    const end = formatTime(session.endTime);
    const label = `[${dateLabel} ${weekday}] ${start}~${end}  ${projectName}  (${session.messageCount}개 메시지)`;

    return {
      value: session.sessionId,
      label,
    };
  });

  const defaultSelected = filteredSessions.map((s) => s.sessionId);

  const selectedIds = await multiselect({
    message: "포함할 세션을 선택해주세요 (스페이스바로 선택/해제, Enter로 확인)",
    options: sessionOptions,
    initialValues: defaultSelected,
  });

  if (isCancel(selectedIds)) {
    outro("취소되었어요.");
    return;
  }

  const selectedSet = new Set(selectedIds as string[]);
  const sessions = filteredSessions.filter((s) => selectedSet.has(s.sessionId));

  if (sessions.length === 0) {
    outro("선택된 세션이 없어요.");
    return;
  }

  // 6. 프로젝트별 그룹핑 (워크트리 → 메인으로 병합)
  const projectMap = new Map<string, ProjectGroup>();

  for (const session of sessions) {
    const mainPath = resolveWorktreeToMain(session.projectPath);
    const projectName = extractProjectName(session.projectPath);

    const existing = projectMap.get(mainPath);
    if (existing) {
      existing.sessions.push(session);
    } else {
      projectMap.set(mainPath, {
        projectName,
        mainRepoPath: mainPath,
        sessions: [session],
        gitLog: "",
      });
    }
  }

  log.info(`${selectedProjectSet.size}개 프로젝트, ${sessions.length}개 세션이 선택되었어요.`);

  // 7. 세션 로그 + git log 수집 (병렬)
  const s = spinner();
  s.start("세션 로그를 수집하는 중...");

  const sessionContents = new Map<string, string>();

  // git log 병렬 수집
  const gitLogPromises = Array.from(projectMap.entries())
    .filter(([, group]) => isGitRepo(group.mainRepoPath))
    .map(async ([key, group]) => {
      const gitLog = await collectGitLog(group.mainRepoPath, rangeStart, rangeEnd);
      return { key, gitLog };
    });

  const gitResults = await Promise.all(gitLogPromises);
  for (const { key, gitLog } of gitResults) {
    const group = projectMap.get(key);
    if (group) {
      group.gitLog = gitLog;
    }
  }

  // 세션 로그 수집 (I/O 바운드이므로 순차 처리로 충분)
  for (const [, group] of projectMap) {
    for (const session of group.sessions) {
      const content = collectSessionLog(session.projectPath, session.sessionId);
      if (content) {
        sessionContents.set(session.sessionId, content);
      }
    }
  }

  s.stop("세션 로그 수집 완료!");

  if (sessionContents.size === 0) {
    outro("수집된 세션 로그가 없어요. 세션 로그 파일이 삭제되었을 수 있어요.");
    return;
  }

  const collectedData: CollectedData = {
    date: targetDate,
    projects: Array.from(projectMap.values()),
    sessionContents,
  };

  // 8. Claude Code로 구조화
  s.start("Claude Code로 구조화하는 중... (1~2분 소요)");

  let tasks: Task[];
  try {
    tasks = await structurizeTasks(collectedData);
  } catch (err: unknown) {
    s.stop("구조화 실패");
    const message = err instanceof Error ? err.message : String(err);
    log.error(`구조화에 실패했어요: ${message}`);
    outro("세션 수를 줄이거나 다시 시도해주세요.");
    return;
  }

  s.stop(`${tasks.length}개 태스크로 구조화 완료!`);

  if (tasks.length === 0) {
    outro("구조화된 태스크가 없어요.");
    return;
  }

  // 9. 인터랙티브 질문
  const result = await runInteractiveSession(tasks);

  if (result.cancelled) {
    outro("취소되었어요.");
    return;
  }

  tasks = result.tasks;

  // 10. 초안 미리보기 + 수정 루프
  let markdown = renderMarkdown(tasks, targetDate, sortedDates);

  while (true) {
    log.message("━━━ 초안 미리보기 ━━━");
    log.message(markdown);
    log.message("━━━━━━━━━━━━━━━━━━");

    const action = await select({
      message: "어떻게 할까요?",
      options: [
        { value: "save", label: "저장" },
        { value: "revise", label: "수정 — 프롬프트로 초안 수정" },
        { value: "cancel", label: "취소" },
      ],
    });

    if (isCancel(action) || action === "cancel") {
      outro("저장이 취소되었어요.");
      return;
    }

    if (action === "save") {
      break;
    }

    // 수정 프롬프트 입력
    const revisionPrompt = await text({
      message: "수정할 내용을 알려주세요.",
      placeholder: "예: 태스크 2 원인 더 상세하게, 해결 부분에 기술적 디테일 추가",
    });

    if (isCancel(revisionPrompt) || !(revisionPrompt as string)?.trim()) {
      continue;
    }

    s.start("초안을 수정하는 중...");
    try {
      markdown = await reviseMarkdown(markdown, revisionPrompt as string);
      s.stop("초안 수정 완료!");
    } catch (err: unknown) {
      s.stop("수정 실패");
      const message = err instanceof Error ? err.message : String(err);
      log.error(`수정에 실패했어요: ${message}`);
    }
  }

  // 11. 프로젝트별 태스크 매칭
  s.start("프로젝트별 일지를 매칭하는 중...");

  const taskFileMap = new Map<number, string | null>();
  const projectNames = [...new Set(tasks.map((t) => t.project).filter((p) => p !== "기타"))];

  for (const projectName of projectNames) {
    const existingFiles = listProjectFiles(config.outputDir, projectName);
    const projectTaskIndices = tasks.map((t, i) => (t.project === projectName ? i : -1)).filter((i) => i !== -1);
    const projectTaskTitles = projectTaskIndices.map((i) => tasks[i].title);

    const matchResult = await matchTasksToFiles(projectTaskTitles, existingFiles);

    for (let j = 0; j < projectTaskIndices.length; j++) {
      taskFileMap.set(projectTaskIndices[j], matchResult.get(j) ?? null);
    }
  }

  s.stop("매칭 완료!");

  // 12. 이중 저장 (시간순 + 프로젝트별)
  const { filePath: dailyPath, overwritten } = saveDailyLog(markdown, config.outputDir);
  const projectPaths = saveProjectLogs(tasks, sortedDates, config.outputDir, taskFileMap);

  if (overwritten) {
    log.warn("기존 일지를 덮어썼어요.");
  }

  log.success(`시간순 일지: ${dailyPath}`);
  if (projectPaths.length > 0) {
    log.success(`프로젝트별 일지: ${projectPaths.length}개 파일 저장`);
  }

  outro("저장 완료!");
}
