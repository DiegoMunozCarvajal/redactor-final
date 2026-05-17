import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@trigger.dev/sdk";

function loadLocalEnvFile(fileName: string) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;

  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    process.env[key] = value;
  }
}

loadLocalEnvFile(".env.local");
loadLocalEnvFile(".env");

const projectRef = process.env.TRIGGER_PROJECT_REF;

if (!projectRef) {
  throw new Error(
    "Missing TRIGGER_PROJECT_REF. Add your Trigger.dev project ref (for example proj_abc123) to your environment before running Trigger.dev.",
  );
}

export default defineConfig({
  project: projectRef,
  dirs: ["./trigger"],
  maxDuration: 900,
});
