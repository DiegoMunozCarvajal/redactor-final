import { defineConfig } from "@trigger.dev/sdk";
import { loadEnvFile } from "./lib/env";

// .env.local takes priority (Next.js convention), .env is fallback.
// During `trigger deploy` the Docker build context lacks .env.local;
// TRIGGER_PROJECT_REF must then come from the shell (--env-file flag)
// or the Trigger.dev dashboard.
loadEnvFile(".env.local");
loadEnvFile(".env");

const projectRef = process.env.TRIGGER_PROJECT_REF;

export default defineConfig({
  project: projectRef ?? "missing-TRIGGER_PROJECT_REF",
  dirs: ["./trigger"],
  maxDuration: 3600, // 1 hour — assembly with many fragments + max effort can exceed 30 min
});
