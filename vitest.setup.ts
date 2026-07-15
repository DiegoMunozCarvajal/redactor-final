// Global test setup — runs before each test file.
// Idempotent: ON CONFLICT DO NOTHING ensures it's safe to run repeatedly.

import postgres from "postgres";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(url, { max: 1, prepare: false });

await sql.unsafe(`
  INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', 'test@test.test', '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000001', 'test2@test.test', '{}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING
`);

await sql.end();
