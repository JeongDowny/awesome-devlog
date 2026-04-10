import { intro, isCancel, log, outro, text } from "@clack/prompts";
import { DEFAULT_OUTPUT_DIR, saveConfig } from "../config/config.js";

export async function runInit(): Promise<void> {
  intro("DevLog Automator — 초기 설정");

  const outputDir = await text({
    message: "데브로그 저장 경로를 입력해주세요",
    placeholder: DEFAULT_OUTPUT_DIR,
    defaultValue: DEFAULT_OUTPUT_DIR,
  });

  if (isCancel(outputDir)) {
    outro("설정이 취소되었어요.");
    return;
  }

  saveConfig({
    outputDir: (outputDir as string) || DEFAULT_OUTPUT_DIR,
  });

  log.success("설정이 완료되었어요!");
  outro("~/.devlog/config.json에 저장했어요.");
}
