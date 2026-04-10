import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DevlogConfig } from "../types/index.js";

const CONFIG_DIR = join(homedir(), ".devlog");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_OUTPUT_DIR = join(homedir(), "devlog");

export function loadConfig(): DevlogConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DevlogConfig>;

    return {
      outputDir: parsed.outputDir ?? DEFAULT_OUTPUT_DIR,
    };
  } catch {
    return null;
  }
}

export function saveConfig(config: Partial<DevlogConfig>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const existing = loadExistingConfig();

  const merged = {
    ...existing,
    ...config,
    outputDir: config.outputDir ?? existing.outputDir ?? DEFAULT_OUTPUT_DIR,
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
}

function loadExistingConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export { CONFIG_PATH, DEFAULT_OUTPUT_DIR };
