"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProjectCardSkeleton } from "@/components/patterns/project-card-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { ContinueWritingCard } from "@/components/patterns/continue-writing-card";
import { QuickStartCard } from "@/components/patterns/quick-start-card";
import { StatsCard } from "@/components/patterns/stats-card";
import { BookOpen, Clock, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import { toast } from "sonner";

interface ProjectData {
  id: string;
  name: string;
  topic: string;
  title: string | null;
  createdAt: string;
  chapterCount?: number;
  completedCount?: number;
}

interface Template {
  id: string;
  name: string;
  status: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const fetchProjects = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/projects", { signal });
      if (signal?.aborted) return;
      if (res.ok) setProjects(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
    setLoading(false);
  }, []);

  const fetchTemplates = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/books", { signal });
      if (signal?.aborted) return;
      if (res.ok) setTemplates(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchProjects(controller.signal);
    fetchTemplates(controller.signal);
    return () => controller.abort();
  }, [fetchProjects, fetchTemplates]);

  const deleteProject = useCallback(async (id: string, name: string) => {
    setDeleteTarget({ id, name });
  }, []);

  async function confirmDeleteProject() {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      toast.error(err.error ?? "Failed to delete");
    }
    fetchProjects();
  }

  // --- Skeleton loading ---
  if (loading) {
    return (
      <div className="py-6">
        <PageHeader
          title="Projects"
          subtitle="Create and manage your book generation projects"
          className="mb-8"
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ProjectCardSkeleton key={i} index={i} />
          ))}
        </div>
      </div>
    );
  }

  // --- Empty state ---
  if (projects.length === 0) {
    return (
      <div className="py-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-2xl bg-accent flex items-center justify-center mb-6">
            <BookOpen className="h-8 w-8 text-brand-500" />
          </div>
          <h2 className="text-xl font-semibold mb-2">
            Your first book is waiting
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-8">
            AI-powered non-fiction books in Spanish. Pick a template, set a
            topic, and generate a complete book chapter by chapter.
          </p>
          <CreateProjectDialog
            templates={templates}
            onOpenChange={(open) => { if (open) fetchTemplates(); }}
          />
          <div className="flex items-center gap-6 mt-8 text-xs text-muted-foreground/60">
            <span>1. Pick template</span>
            <span className="text-border">&#8594;</span>
            <span>2. Set topic</span>
            <span className="text-border">&#8594;</span>
            <span>3. Generate</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Compute stats from API response ---
  const totalChapters = projects.reduce(
    (sum, p) => sum + (p.chapterCount ?? 0),
    0,
  );
  const completedChapters = projects.reduce(
    (sum, p) => sum + (p.completedCount ?? 0),
    0,
  );

  // Last active project = first in list
  const lastProject = projects[0];

  // Remaining projects (skip the first one)
  const remainingProjects = projects.slice(1);

  return (
    <div className="py-6">
      <PageHeader
        title="Projects"
        subtitle="Create and manage your book generation projects"
        className="mb-8"
      />

      {/* Bento Hero Row */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="md:col-span-2 md:row-span-2">
          <ContinueWritingCard
            project={lastProject}
            onDelete={deleteProject}
          />
        </div>
        <QuickStartCard
          templates={templates}
          onOpenChange={(open) => { if (open) fetchTemplates(); }}
        />
        <StatsCard
          totalProjects={projects.length}
          totalChapters={totalChapters}
          completedChapters={completedChapters}
        />
      </div>

      {/* Regular Project Grid (remaining projects) */}
      {remainingProjects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {remainingProjects.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: i * 0.05,
                duration: 0.25,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative group"
            >
              <Link href={`/projects/${p.id}`}>
                <Card className="hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200">
                  <CardHeader>
                    <div className="flex items-start gap-2">
                      <BookOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                      <CardTitle className="group-hover:text-primary transition-colors">
                        {p.name}
                      </CardTitle>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {p.topic}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(p.createdAt), {
                        addSuffix: true,
                        locale: enUS,
                      })}
                    </span>
                  </CardContent>
                </Card>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 z-10"
                onClick={(e) => {
                  e.preventDefault();
                  deleteProject(p.id, p.name);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </motion.div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description={`Delete project "${deleteTarget?.name ?? ""}" and all its generations? This cannot be undone.`}
        onConfirm={confirmDeleteProject}
      />
    </div>
  );
}
