import { NextRequest, NextResponse } from "next/server";
import { csrfCheck } from "@/lib/api/csrf";
import { requireAdmin } from "@/lib/auth/admin";
import {
  deletePromptRevision,
  PromptRevisionDeleteError,
} from "@/lib/prompts/admin-repository";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.authorized) return admin.response;

  const { id, revisionId } = await params;

  try {
    const deleted = await deletePromptRevision(id, revisionId);
    return NextResponse.json(deleted);
  } catch (error) {
    if (error instanceof PromptRevisionDeleteError) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        IS_DEFAULT: 409,
        HAS_BINDINGS: 409,
        DEFINITION_ARCHIVED: 400,
      };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] ?? 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
