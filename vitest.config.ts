import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.claude/**"],
    pool: "forks",
    setupFiles: ["./vitest.setup.ts"],
    poolOptions: {
      forks: {
        execArgv: ["--no-deprecation"],
      },
    },
    env: {
      // Test defaults. Override with TEST_DATABASE_URL for DB-dependent tests.
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    },
  },
});
