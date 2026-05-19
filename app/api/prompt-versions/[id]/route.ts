import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [version] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.id, id))
    .limit(1);

  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(version);
}
