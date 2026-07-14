import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
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
    },
  },
});
