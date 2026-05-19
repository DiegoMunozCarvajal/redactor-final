import { motion } from "motion/react";

export function ProjectCardSkeleton({ index }: { index: number }) {
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
      <div className="rounded-lg border bg-card p-6 animate-pulse">
        <div className="flex items-start gap-2">
          <div className="h-5 w-5 bg-muted rounded shrink-0 mt-0.5" />
          <div className="flex-1 space-y-3">
            <div
              className="h-5 bg-muted rounded"
              style={{ width: `${60 + (index % 3) * 12}%` }}
            />
            <div
              className="h-4 bg-muted rounded"
              style={{ width: `${80 + (index % 2) * 10}%` }}
            />
          </div>
        </div>
        <div
          className="h-3 bg-muted rounded mt-4"
          style={{ width: `${30 + (index % 3) * 8}%` }}
        />
      </div>
    </motion.div>
  );
}
