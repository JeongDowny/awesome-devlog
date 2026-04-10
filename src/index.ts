import { outro } from "@clack/prompts";
import { runGenerate } from "./commands/generate.js";
import { runInit } from "./commands/init.js";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "init") {
    await runInit();
  } else {
    await runGenerate();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
  outro(`오류: ${message}`);
  process.exit(1);
});
