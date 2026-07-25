import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy-initialized DB connection. Task files are imported at build time
// (Trigger.dev indexer) where DATABASE_URL is unavailable. Deferring
// connection creation lets the module graph load without a live database.
// The connection is created on first access at task runtime.

declare global {
  var __redactorPostgresClient:
    | ReturnType<typeof postgres>
    | undefined;
}

let _db: PostgresJsDatabase<typeof schema> | undefined;
let _client: ReturnType<typeof postgres> | undefined;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is required");
  return url;
}

function createPostgresClient() {
  return postgres(getConnectionString(), {
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 5 : 6,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

function getClient(): ReturnType<typeof postgres> {
  if (!_client) {
    _client = globalThis.__redactorPostgresClient ?? createPostgresClient();
    if (process.env.NODE_ENV !== "production") {
      globalThis.__redactorPostgresClient = _client;
    }
  }
  return _client;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getClient(), { schema });
  }
  return _db;
}

// Proxy that lazily creates the DB on first property access.
// Works transparently — all callers use `db` as before.
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (getDb() as any)[prop];
    },
  },
);

// Lazy client accessor for consumers that need the raw pool
// (e.g. lib/db/lock-pool.ts, lib/api/rate-limit.ts).
export const client: ReturnType<typeof postgres> = new Proxy(
  {} as ReturnType<typeof postgres>,
  {
    get(_target, prop) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (getClient() as any)[prop];
    },
  },
);
