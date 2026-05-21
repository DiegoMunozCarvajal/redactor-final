import Link from "next/link";
import { BookOpen, Clock, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS } from "date-fns/locale";
import { Button } from "@/components/ui/button";

interface ContinueWritingCardProps {
  project: {
    id: string;
    title: string | null;
    name: string;
    topic: string;
    createdAt: string;
    chapterCount?: number;
    completedCount?: number;
  };
  onDelete?: (id: string, name: string) => void;
}

export function ContinueWritingCard({ project, onDelete }: ContinueWritingCardProps) {
  const progress = (project.chapterCount ?? 0) > 0
    ? Math.round(((project.completedCount ?? 0) / (project.chapterCount ?? 1)) * 100)
    : 0;

  return (
    <div className="relative group h-full">
      <Link href={`/projects/${project.id}`}>
        <div className="rounded-lg border bg-gradient-to-br from-brand-50/50 to-accent/30 dark:from-brand-900/20 dark:to-accent/20 p-6 hover:border-brand-200 dark:hover:border-brand-700 transition-all duration-200 h-full flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <BookOpen className="h-3.5 w-3.5 text-brand-500" />
            Continue Writing
          </div>
          <h3 className="text-lg font-semibold mb-1 line-clamp-1">
            {project.title ?? project.name}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
            {project.topic}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>
              {project.completedCount ?? 0}/{project.chapterCount ?? 0} chapters
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(project.createdAt), {
              addSuffix: true,
              locale: enUS,
            })}
          </div>
        </div>
        </div>
      </Link>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 z-10"
          onClick={(e) => {
            e.preventDefault();
            onDelete(project.id, project.name);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
