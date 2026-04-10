import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { intro, isCancel, log, outro, select } from "@clack/prompts";
import { marked } from "marked";
import { loadConfig } from "../config/config.js";

const HTML_TEMPLATE = (title: string, body: string): string => `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 860px;
    margin: 0 auto;
    padding: 2rem;
    color: #1f2328;
    background: #ffffff;
  }

  @media (prefers-color-scheme: dark) {
    body { color: #e6edf3; background: #0d1117; }
    a { color: #58a6ff; }
    blockquote { border-color: #3d444d; color: #9198a1; }
    code { background: #161b22; }
    pre { background: #161b22 !important; }
    hr { border-color: #30363d; }
    table th { background: #161b22; }
    table td, table th { border-color: #30363d; }
  }

  h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; margin-top: 1.5em; }
  h3 { font-size: 1.25em; margin-top: 1.2em; }

  blockquote {
    margin: 0;
    padding: 0 1em;
    color: #656d76;
    border-left: 0.25em solid #d0d7de;
  }

  code {
    background: #f6f8fa;
    padding: 0.2em 0.4em;
    border-radius: 6px;
    font-size: 85%;
  }

  pre {
    background: #f6f8fa;
    padding: 1em;
    border-radius: 6px;
    overflow-x: auto;
  }

  pre code { background: transparent; padding: 0; }

  hr { border: none; border-top: 1px solid #d1d9e0; margin: 1.5em 0; }

  table { border-collapse: collapse; width: 100%; }
  table th, table td { border: 1px solid #d0d7de; padding: 6px 13px; }
  table th { background: #f6f8fa; font-weight: 600; }

  strong { font-weight: 600; }
</style>
</head>
<body>
${body}
</body>
</html>`;

export async function runView(filePath?: string): Promise<void> {
  intro("DevLog Viewer");

  let targetPath: string;

  if (filePath && existsSync(filePath)) {
    targetPath = filePath;
  } else {
    const config = loadConfig();
    if (!config) {
      log.error("설정이 없어요. 먼저 `devlog init`을 실행해주세요.");
      outro("");
      return;
    }

    const resolved = await selectFile(config.outputDir);
    if (!resolved) return;
    targetPath = resolved;
  }

  const mdContent = readFileSync(targetPath, "utf-8");
  const htmlBody = await marked(mdContent, { gfm: true });
  const title = basename(targetPath, ".md");
  const html = HTML_TEMPLATE(title, htmlBody);

  const tmpDir = mkdtempSync(join(tmpdir(), "devlog-"));
  const htmlPath = join(tmpDir, `${title}.html`);
  writeFileSync(htmlPath, html, "utf-8");

  spawn("open", [htmlPath], { detached: true, stdio: "ignore" }).unref();

  outro(`브라우저에서 열었어요! → ${basename(targetPath)}`);
}

async function selectFile(outputDir: string): Promise<string | null> {
  const source = await select({
    message: "어떤 일지를 볼까요?",
    options: [
      { value: "daily", label: "최근 일지 (시간순)" },
      { value: "project", label: "프로젝트별 일지" },
    ],
  });

  if (isCancel(source)) {
    outro("취소되었어요.");
    return null;
  }

  if (source === "daily") {
    return selectDailyFile(outputDir);
  }
  return selectProjectFile(outputDir);
}

async function selectDailyFile(outputDir: string): Promise<string | null> {
  const dailyDir = join(outputDir, "daily");
  if (!existsSync(dailyDir)) {
    log.error("아직 저장된 일지가 없어요.");
    outro("");
    return null;
  }

  const files = readdirSync(dailyDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  if (files.length === 0) {
    log.error("아직 저장된 일지가 없어요.");
    outro("");
    return null;
  }

  const selected = await select({
    message: "열어볼 일지를 선택해주세요",
    options: files.map((f) => ({ value: f, label: f.replace(".md", "") })),
  });

  if (isCancel(selected)) {
    outro("취소되었어요.");
    return null;
  }

  return join(dailyDir, selected as string);
}

async function selectProjectFile(outputDir: string): Promise<string | null> {
  const projectsDir = join(outputDir, "projects");
  if (!existsSync(projectsDir)) {
    log.error("아직 저장된 프로젝트별 일지가 없어요.");
    outro("");
    return null;
  }

  const projects = readdirSync(projectsDir).filter((d) => {
    const fullPath = join(projectsDir, d);
    try {
      return readdirSync(fullPath).some((f) => f.endsWith(".md"));
    } catch {
      return false;
    }
  });

  if (projects.length === 0) {
    log.error("아직 저장된 프로젝트별 일지가 없어요.");
    outro("");
    return null;
  }

  const selectedProject = await select({
    message: "프로젝트를 선택해주세요",
    options: projects.map((p) => ({ value: p, label: p })),
  });

  if (isCancel(selectedProject)) {
    outro("취소되었어요.");
    return null;
  }

  const projectDir = join(projectsDir, selectedProject as string);
  const files = readdirSync(projectDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    log.error("이 프로젝트에 저장된 일지가 없어요.");
    outro("");
    return null;
  }

  const selectedFile = await select({
    message: "열어볼 태스크를 선택해주세요",
    options: files.map((f) => ({ value: f, label: f.replace(".md", "") })),
  });

  if (isCancel(selectedFile)) {
    outro("취소되었어요.");
    return null;
  }

  return join(projectDir, selectedFile as string);
}
