import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chapterPlaceholders } from "./chapter-placeholders";
import { chapterGenerations } from "./chapter-generations";
import type { PlaceholderFillMetadata } from "@/lib/placeholder-fill-metadata";

export const placeholderVersions = pgTable("placeholder_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  placeholderId: uuid("placeholder_id")
    .notNull()
    .references(() => chapterPlaceholders.id, { onDelete: "cascade" }),
  definition: text("definition"),
  fillMetadata: jsonb("fill_metadata").$type<PlaceholderFillMetadata>(),
  chapterGenerationId: uuid("chapter_generation_id").references(
    () => chapterGenerations.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlaceholderVersion = typeof placeholderVersions.$inferSelect;
export type NewPlaceholderVersion = typeof placeholderVersions.$inferInsert;
