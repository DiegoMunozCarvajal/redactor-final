import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

if (!process.env.DATABASE_URL && existsSync(".env")) {
  loadEnvFile(".env");
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Set it in .env.local or .env before running Drizzle."
  );
}

export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
