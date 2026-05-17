import { sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";

export interface SourceChunkSchemaSupport {
  pageNumber: boolean;
  sectionTitle: boolean;
  charOffsets: boolean;
}

let sourceChunkSchemaSupportPromise: Promise<SourceChunkSchemaSupport> | null = null;
let sourceChunkSchemaCachedAt = 0;
const SCHEMA_CACHE_TTL_MS = 60_000;

async function loadSourceChunkSchemaSupport(): Promise<SourceChunkSchemaSupport> {
  const rows = (await db.execute(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'source_chunks'
      and column_name in ('page_number', 'section_title', 'char_start', 'char_end')
  `)) as unknown as Array<{ column_name: string }>;

  const columns = new Set(rows.map((row) => row.column_name));

  return {
    pageNumber: columns.has("page_number"),
    sectionTitle: columns.has("section_title"),
    charOffsets: columns.has("char_start") && columns.has("char_end"),
  };
}

export function getSourceChunkSchemaSupport(): Promise<SourceChunkSchemaSupport> {
  if (!sourceChunkSchemaSupportPromise || Date.now() - sourceChunkSchemaCachedAt > SCHEMA_CACHE_TTL_MS) {
    sourceChunkSchemaCachedAt = Date.now();
    sourceChunkSchemaSupportPromise = loadSourceChunkSchemaSupport();
  }

  return sourceChunkSchemaSupportPromise;
}
