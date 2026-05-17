import Link from "next/link";
import { db } from "@/lib/db";
import { projects, bookTemplates } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc } from "drizzle-orm";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const userProjects = user
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.userId, user.id))
        .orderBy(desc(projects.createdAt))
    : [];

  const templates = await db.select().from(bookTemplates);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Proyectos</h1>
        <CreateProjectDialog templates={templates} />
      </div>

      {userProjects.length === 0 ? (
        <p className="text-muted-foreground">No projects yet. Create one to start.</p>
      ) : (
        <div className="space-y-2">
          {userProjects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="block p-4 border rounded-lg hover:bg-accent transition-colors"
            >
              <h2 className="font-medium">{p.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">Tema: {p.topic}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
