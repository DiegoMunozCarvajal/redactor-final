/**
 * Test database helpers.
 *
 * Strategy: transaction rollback isolation.
 * Each test that needs DB access wraps its work in `withTestDb()`.
 * The transaction is rolled back after the callback completes, leaving
 * no side effects. This is fast (no schema teardown) and safe for
 * parallel test execution when each test file gets its own DB session.
 *
 * Requires TEST_DATABASE_URL env var pointing to a test PostgreSQL instance.
 *
 * Usage:
 *   import { withTestDb } from "@/lib/__tests__/helpers/db";
 *
 *   it("creates a project", async () => {
 *     await withTestDb(async (db) => {
 *       const [project] = await db.insert(projects).values({...}).returning();
 *       expect(project.name).toBe("Test");
 *     });
 *   });
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

function getTestConnectionUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url) return url;

  // Fall back to local Supabase or Docker PostgreSQL
  return "postgresql://postgres:postgres@localhost:5432/redactor_test";
}

let _testClient: ReturnType<typeof postgres> | null = null;
let _testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getTestClient(): ReturnType<typeof postgres> {
  if (!_testClient) {
    _testClient = postgres(getTestConnectionUrl(), {
      prepare: false,
      max: 1,
    });
  }
  return _testClient;
}

function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_testDb) {
    _testDb = drizzle(getTestClient(), { schema });
  }
  return _testDb;
}

/**
 * Execute a callback inside a test database transaction.
 * The transaction is always rolled back, so tests never leave side effects.
 * Uses savepoints for nested transaction safety.
 */
export async function withTestDb<T>(
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const db = getTestDb();

  // Use a savepoint so nested calls don't conflict
  await db.execute("SAVEPOINT test_begin");

  try {
    const result = await fn(db);
    return result;
  } finally {
    await db.execute("ROLLBACK TO SAVEPOINT test_begin");
  }
}

/**
 * Close the test connection pool. Call in globalTeardown if needed.
 */
export async function closeTestDb(): Promise<void> {
  if (_testClient) {
    await _testClient.end();
    _testClient = null;
    _testDb = null;
  }
}
