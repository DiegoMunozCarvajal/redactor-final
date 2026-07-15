import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { promptDefinitions } from "@/lib/db/schema/prompt-registry";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getPromptDefinitionDetail,
  setPromptDefinitionArchived,
  PromptArchiveConflictError,
} from "@/lib/prompts/admin-repository";

const archiveSchema = z.object({ archived: z.boolean() }).strict();
const metadataSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((d) => d.name !== undefined || d.description !== undefined, {
    message: "at least one of name or description is required",
  });

const patchBodySchema = z.union([archiveSchema, metadataSchema]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const detail = await getPromptDefinitionDetail(id);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw error;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Archive / restore
  if ("archived" in parsed.data) {
    try {
      const result = await setPromptDefinitionArchived(id, parsed.data.archived);
      if (!result.found) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ id, archived: parsed.data.archived });
    } catch (error) {
      if (error instanceof PromptArchiveConflictError) {
        return NextResponse.json(
          {
            error: error.message,
            blockers: {
              defaultCount: error.blockers.defaultCount,
              bindingCount: error.blockers.bindingCount,
            },
          },
          { status: 409 },
        );
      }
      throw error;
    }
  }

  // Metadata update
  const [updated] = await db
    .update(promptDefinitions)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
    })
    .where(eq(promptDefinitions.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
