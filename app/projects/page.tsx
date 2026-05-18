import { db } from "@/lib/db";
import { projects, runs, bookTemplates } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectCard } from "@/components/patterns/project-card";
import { BookOpen } from "lucide-react";

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

  const projectIds = userProjects.map((p) => p.id);
  const runCounts =
    projectIds.length > 0
      ? await db
          .select({ projectId: runs.projectId, count: sql<number>`count(*)` })
          .from(runs)
          .where(inArray(runs.projectId, projectIds))
          .groupBy(runs.projectId)
      : [];

  const projectsWithCounts = userProjects.map((p) => ({
    ...p,
    runCount: runCounts.find((rc) => rc.projectId === p.id)?.count ?? 0,
  }));

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage your book generation projects
          </p>
        </div>
        <CreateProjectDialog templates={templates} />
      </div>

      {projectsWithCounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-medium mb-1">No projects yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create your first project to start generating AI-powered books in
            Spanish.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projectsWithCounts.map((p, i) => (
            <ProjectCard key={p.id} project={p} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
