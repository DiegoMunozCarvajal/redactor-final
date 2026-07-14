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
import { TransactionRollbackError } from "drizzle-orm/errors";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

function getTestConnectionUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url) return url;

  throw new Error(
    "TEST_DATABASE_URL is not set and no local PostgreSQL is available. " +
      "Set TEST_DATABASE_URL to a disposable test database.",
  );
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
 * Execute a callback inside a real Drizzle database transaction.
 * The transaction is always rolled back, so tests never leave side effects.
 *
 * Uses Drizzle's `db.transaction()` to open a real PostgreSQL transaction.
 * After the callback completes, `tx.rollback()` is called, which throws a
 * `TransactionRollbackError` sentinel that is caught and suppressed.
 *
 * If the callback itself throws, the error is preserved and rethrown after
 * the rollback completes.
 */
export async function withTestDb<T>(
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const db = getTestDb();

  let result: T | undefined;
  let userError: unknown;

  try {
    await db.transaction(async (tx) => {
      try {
        // `tx` is a PgTransaction which doesn't expose the `$client` property
        // that `ReturnType<typeof drizzle>` has, but for query operations the
        // two types are mutually compatible. The double cast is required because
        // TypeScript sees them as structurally incompatible.
        result = await fn(tx as unknown as ReturnType<typeof drizzle<typeof schema>>);
      } catch (e) {
        userError = e;
      }
      // Always roll back — this throws TransactionRollbackError
      tx.rollback();
    });
  } catch (e) {
    // Swallow only the expected Drizzle rollback sentinel
    if (!(e instanceof TransactionRollbackError)) {
      throw e;
    }
  }

  if (userError !== undefined) {
    throw userError;
  }

  return result as T;
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
