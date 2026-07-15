import { defineConfig } from "@trigger.dev/sdk";
import { loadEnvFile } from "./lib/env";

// .env.local takes priority (Next.js convention), .env is fallback
loadEnvFile(".env.local");
loadEnvFile(".env");

const projectRef = process.env.TRIGGER_PROJECT_REF;

if (!projectRef) {
  throw new Error(
    "Missing TRIGGER_PROJECT_REF. Add your Trigger.dev project ref (for example proj_abc123) to your environment before running Trigger.dev.",
  );
}

export default defineConfig({
  project: projectRef,
  dirs: ["./trigger"],
  maxDuration: 3600, // 1 hour — assembly with many fragments + max effort can exceed 30 min
});
