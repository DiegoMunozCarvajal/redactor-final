"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { BookOpen, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";

export function ProjectCard({
  project,
  index,
}: {
  project: {
    id: string;
    name: string;
    topic: string;
    title: string | null;
    createdAt: Date;
  };
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.05,
        duration: 0.25,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <Link href={`/projects/${project.id}`}>
        <Card className="hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200 group">
          <CardHeader style={{ padding: `calc(var(--density-card-padding-y)) calc(var(--density-card-padding-x))` }}>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="group-hover:text-primary transition-colors">
                {project.title ?? project.name}
              </CardTitle>
              <BookOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            </div>
            <CardDescription className="line-clamp-2">
              {project.topic}
            </CardDescription>
          </CardHeader>
          <CardContent
            className="flex items-center gap-3 text-xs text-muted-foreground"
            style={{ padding: `0 calc(var(--density-card-padding-x)) calc(var(--density-card-padding-y))` }}
          >
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(project.createdAt, {
                addSuffix: true,
                locale: enUS,
              })}
            </span>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
