import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";
import { csrfCheck } from "@/lib/api/csrf";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = csrfCheck(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { description } = body;

  if (description !== undefined && typeof description !== "string") {
    return NextResponse.json(
      { error: "description must be a string" },
      { status: 400 },
    );
  }

  if (description.length > 5000) {
    return NextResponse.json(
      { error: "description must be 5000 characters or less" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(projects)
    .set(description !== undefined ? { description } : {})
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
