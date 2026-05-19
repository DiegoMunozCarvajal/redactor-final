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
import { BookOpen, Clock, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";

interface ProjectData {
  id: string;
  name: string;
  topic: string;
  title: string | null;
  createdAt: string;
}

interface Template {
  id: string;
  name: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function deleteProject(id: string, name: string) {
    if (!confirm(`Delete project "${name}" and all its generations?`)) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) {
      fetchProjects();
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to delete" }));
      alert(err.error ?? "Failed to delete");
    }
  }

  if (loading) {
    return (
      <div className="py-6">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage your book generation projects
          </p>
        </div>
        <CreateProjectDialog templates={templates} />
      </div>

      {projects.length === 0 ? (
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
          {projects.map((p, i) => (
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
                        {p.title ?? p.name}
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
    </div>
  );
}
