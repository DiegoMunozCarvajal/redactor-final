import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL environment variable is required");
const databaseUrl: string = connectionString;

declare global {
  var __redactorLockClient: ReturnType<typeof postgres> | undefined;
}

function createLockClient() {
  return postgres(databaseUrl, {
    prepare: false,
    // Small dedicated pool for advisory locks only.
    // max: 2 prevents exhaustion while allowing two projects to lock concurrently.
    max: 2,
    // Shorter timeouts since lock operations are fast and transactional.
    idle_timeout: 10,
    connect_timeout: 5,
  });
}

const lockClient = globalThis.__redactorLockClient ?? createLockClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__redactorLockClient = lockClient;
}

export { lockClient };
