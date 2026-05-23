import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL environment variable is required");
const databaseUrl: string = connectionString;

declare global {
  var __redactorPostgresClient:
    | ReturnType<typeof postgres>
    | undefined;
}

function createPostgresClient() {
  return postgres(databaseUrl, {
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

const client =
  globalThis.__redactorPostgresClient ?? createPostgresClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__redactorPostgresClient = client;
}

export const db = drizzle(client, { schema });
export { client };
