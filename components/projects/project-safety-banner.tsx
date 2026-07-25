import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import Link from "next/link";

export interface ProjectSafety {
  state: "source_free" | "clean_v2" | "legacy_read_only";
  reasonCode?: string;
  replacementProjectId?: string;
}

export function ProjectSafetyBanner({
  safety,
}: {
  safety: ProjectSafety;
}) {
  if (safety.state === "clean_v2") return null;

  return (
    <div data-testid="project-safety-banner" className="mb-6">
      {safety.state === "legacy_read_only" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Proyecto legacy: solo lectura</AlertTitle>
          <AlertDescription>
            <p>
              Este proyecto fue creado antes de la verificacion de originalidad
              y no puede ser modificado.
            </p>
            {safety.replacementProjectId && (
              <Link
                href={`/projects/${safety.replacementProjectId}`}
                className="mt-2 inline-block underline"
              >
                Abrir proyecto limpio
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {safety.state === "source_free" && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Proyecto sin fuentes protegidas</AlertTitle>
          <AlertDescription>
            <p>Este proyecto utiliza contenido sin fuentes verificadas.</p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
