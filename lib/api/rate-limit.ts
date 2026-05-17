import postgres from "postgres";
import { db } from "@/lib/db/drizzle";
import { runs } from "@/lib/db/schema";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

const WINDOW_SECONDS = 60;
const MAX_RUNS_PER_WINDOW = 1;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL environment variable is required");

// Dedicated client for advisory locks. begin() reserves a single connection
// for the entire lock+callback+release span, preventing connection-pool reuse
// within the critical section. Pool size allows concurrent requests to
// different projects (advisory lock serializes same-project at PG level).
const lockClient = postgres(databaseUrl, {
  prepare: false,
  max: 10,
  idle_timeout: 300,
  connect_timeout: 10,
});

function projectIdToLockKey(projectId: string): [number, number] {
  const hex = projectId.replace(/-/g, "");
  // | 0 converts to signed 32-bit to fit PostgreSQL int4 range
  const key1 = parseInt(hex.substring(0, 8), 16) | 0;
  const key2 = parseInt(hex.substring(8, 16), 16) | 0;
  return [key1, key2];
}

export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>
): Promise<{ locked: false } | { locked: true; result: T }> {
  const [key1, key2] = projectIdToLockKey(projectId);

  return lockClient.begin(async (tx) => {
    const [row] = await tx.unsafe(
      `SELECT pg_try_advisory_lock($1, $2) AS acquired`,
      [key1, key2]
    );

    if (!row.acquired) {
      return { locked: false };
    }

    try {
      const result = await fn();
      return { locked: true, result };
    } finally {
      await tx.unsafe(`SELECT pg_advisory_unlock($1, $2)`, [key1, key2]).catch(() => {});
    }
  }) as Promise<{ locked: false } | { locked: true; result: T }>;
}

export async function checkProjectRateLimit(
  projectId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        gte(runs.createdAt, windowStart),
        inArray(runs.status, ["running"])
      )
    );

  const recentRuns = row?.count ?? 0;

  if (recentRuns >= MAX_RUNS_PER_WINDOW) {
    return { allowed: false, retryAfter: WINDOW_SECONDS };
  }

  return { allowed: true };
}
