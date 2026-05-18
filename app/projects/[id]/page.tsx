import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { projects, runs } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { eq, desc } from "drizzle-orm";
import { GenerateButton } from "@/components/projects/generate-button";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { ArrowRight, BookOpen, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success/10 text-success border-success/20">
          Completado
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-info/10 text-info border-info/20">
          Generando
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Fallido</Badge>;
    case "pending":
      return <Badge variant="outline">Pendiente</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { id } = await params;

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) notFound();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project || project.userId !== user?.id) notFound();

  const runList = await db
    .select()
    .from(runs)
    .where(eq(runs.projectId, id))
    .orderBy(desc(runs.createdAt));

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
      />

      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">{project.name}</CardTitle>
              <CardDescription className="mt-1.5 text-base">
                {project.topic}
              </CardDescription>
            </div>
            <BookOpen className="h-6 w-6 text-muted-foreground shrink-0 mt-1" />
          </div>
        </CardHeader>
        <CardContent>
          <GenerateButton projectId={id} />
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold mt-8 mb-4">
        Historial de Ejecuciones
      </h2>

      {runList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg">
          <Clock className="h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            No runs yet. Generate your first book to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {runList.map((run) => (
            <Link
              key={run.id}
              href={`/projects/${id}/runs/${run.id}`}
              className="block"
            >
              <Card className="hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200 group">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {statusBadge(run.status)}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {run.title ?? `Run ${run.id.slice(0, 8)}...`}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(run.createdAt, {
                          addSuffix: true,
                          locale: es,
                        })}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
