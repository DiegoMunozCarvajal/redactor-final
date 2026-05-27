import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface ResourceCardProps {
  href: string;
  title: string;
  description?: string | null;
  onDelete?: () => void;
  children?: React.ReactNode;
}

export function ResourceCard({
  href,
  title,
  description,
  onDelete,
  children,
}: ResourceCardProps) {
  return (
    <Card className="group relative hover:border-brand-200 dark:hover:border-brand-800 hover:shadow-sm transition-all duration-200">
      <Link href={href}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base group-hover:text-primary transition-colors">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {description ? (
            <CardDescription className="line-clamp-2">
              {description}
            </CardDescription>
          ) : (
            <CardDescription className="italic">
              No description
            </CardDescription>
          )}
          {children}
        </CardContent>
      </Link>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </Card>
  );
}
