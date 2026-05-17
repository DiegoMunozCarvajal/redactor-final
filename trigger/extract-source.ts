import { task } from "@trigger.dev/sdk";
import { db } from "@/lib/db/drizzle";
import { sources } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { downloadSourceFile } from "@/lib/storage/sources";
import { extractText } from "@/lib/extraction";
import { updateSourceProcessingState } from "@/lib/db/queries/sources";

export const extractSourceTask = task({
  id: "extract-source",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
  },
  run: async (payload: { sourceId: string; projectId: string }) => {
    const { sourceId } = payload;

    // Check if source exists before starting work (single query reused for data)
    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, sourceId));

    if (!source) {
      // Source was deleted before task started - exit gracefully
      return {
        sourceId,
        status: "cancelled",
        reason: "Source was deleted before extraction started",
      };
    }

    try {
      await updateSourceProcessingState(sourceId, {
        processingStatus: "extracting",
        processingError: null,
        processed: false,
        processedAt: null,
      });

      const [refreshed] = await db
        .select()
        .from(sources)
        .where(eq(sources.id, sourceId));

      if (!refreshed) {
        // Source was deleted during processing - exit gracefully
        return {
          sourceId,
          status: "cancelled",
          reason: "Source was deleted during extraction",
        };
      }
      if (!refreshed.storagePath) {
        throw new Error(`Source ${refreshed.fileName} has no uploaded file yet`);
      }

      const buffer = await downloadSourceFile(refreshed.storagePath);
      const extractedText = await extractText(buffer, refreshed.fileType);

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error(`No text extracted from ${refreshed.fileName}`);
      }

      await updateSourceProcessingState(sourceId, {
        extractedText,
        processingStatus: "chunking",
        processingError: null,
        processed: false,
      });

      const { chunkAndEmbedTask } = await import("./chunk-and-embed");
      await chunkAndEmbedTask.trigger({ sourceId, projectId: payload.projectId });

      return {
        sourceId,
        status: "extracted",
        textLength: extractedText.length,
      };
    } catch (error) {
      // Check if source still exists before updating error state
      const [stillExists] = await db
        .select()
        .from(sources)
        .where(eq(sources.id, sourceId));

      if (stillExists) {
        await updateSourceProcessingState(sourceId, {
          processingStatus: "failed",
          processingError:
            error instanceof Error ? error.message : "Source extraction failed",
          processed: false,
        });
      }
      throw error;
    }
  },
});
