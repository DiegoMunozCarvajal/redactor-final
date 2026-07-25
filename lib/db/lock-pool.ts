import postgres from "postgres";

// Lazy-initialized lock pool. See lib/db/drizzle.ts for rationale —
// module-level connection creation breaks Trigger.dev build indexing.

declare global {
  var __redactorLockClient: ReturnType<typeof postgres> | undefined;
}

let _lockClient: ReturnType<typeof postgres> | undefined;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is required");
  return url;
}

function createLockClient() {
  return postgres(getConnectionString(), {
    prepare: false,
    // Small dedicated pool for advisory locks only.
    // max: 2 prevents exhaustion while allowing two projects to lock concurrently.
    max: 2,
    // Shorter timeouts since lock operations are fast and transactional.
    idle_timeout: 10,
    connect_timeout: 5,
  });
}

function getLockClient(): ReturnType<typeof postgres> {
  if (!_lockClient) {
    _lockClient = globalThis.__redactorLockClient ?? createLockClient();
    if (process.env.NODE_ENV !== "production") {
      globalThis.__redactorLockClient = _lockClient;
    }
  }
  return _lockClient;
}

// Proxy that lazily creates the lock pool on first access.
export const lockClient: ReturnType<typeof postgres> = new Proxy(
  {} as ReturnType<typeof postgres>,
  {
    get(_target, prop) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (getLockClient() as any)[prop];
    },
  },
);
