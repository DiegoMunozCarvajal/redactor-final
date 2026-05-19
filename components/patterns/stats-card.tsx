import { Layers, CheckCircle2, FileText } from "lucide-react";

interface StatsCardProps {
  totalProjects: number;
  totalChapters: number;
  completedChapters: number;
}

export function StatsCard({
  totalProjects,
  totalChapters,
  completedChapters,
}: StatsCardProps) {
  const stats = [
    {
      icon: FileText,
      value: totalProjects,
      label: "Projects",
    },
    {
      icon: Layers,
      value: totalChapters,
      label: "Chapters",
    },
    {
      icon: CheckCircle2,
      value: completedChapters,
      label: "Completed",
    },
  ];

  return (
    <div className="rounded-lg border bg-card p-6 h-full flex flex-col justify-center">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <s.icon className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
            <div className="text-xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
