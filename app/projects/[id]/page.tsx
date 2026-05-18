import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { projects, runs } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc } from "drizzle-orm";
import { GenerateButton } from "@/components/projects/generate-button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { id } = await params;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) notFound();

  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project || project.userId !== user?.id) notFound();

  const runList = await db
    .select()
    .from(runs)
    .where(eq(runs.projectId, id))
    .orderBy(desc(runs.createdAt));

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
      />
      <h1 className="text-2xl font-bold mb-2">{project.name}</h1>
      <p className="text-muted-foreground mb-6">Tema: {project.topic}</p>

      <GenerateButton projectId={id} />

      <h2 className="text-lg font-semibold mt-8 mb-3">Runs</h2>
      {runList.length === 0 ? (
        <p className="text-muted-foreground text-sm">No runs yet.</p>
      ) : (
        <div className="space-y-2">
          {runList.map((run) => (
            <Link
              key={run.id}
              href={`/projects/${id}/runs/${run.id}`}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
            >
              <span className="text-sm font-mono">{run.id.slice(0, 8)}...</span>
              <span className="text-xs px-2 py-0.5 rounded bg-muted">{run.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
