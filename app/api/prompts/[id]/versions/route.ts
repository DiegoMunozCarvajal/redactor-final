import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptVersions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const versions = await db
    .select({
      id: promptVersions.id,
      title: promptVersions.title,
      createdAt: promptVersions.createdAt,
    })
    .from(promptVersions)
    .where(eq(promptVersions.promptId, id))
    .orderBy(desc(promptVersions.createdAt));

  return NextResponse.json(versions);
}
