import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import Link from "next/link";

export interface TemplateSafety {
  classification:
    | "legacy_unverified"
    | "suspect"
    | "contaminated"
    | "clean_v2";
  replacementTemplateId?: string;
}

export function TemplateSafetyBanner({
  safety,
}: {
  safety: TemplateSafety;
}) {
  if (safety.classification === "clean_v2") return null;

  return (
    <div data-testid="template-safety-banner" className="mb-6">
      {safety.classification === "contaminated" && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Plantilla contaminada</AlertTitle>
          <AlertDescription>
            <p>
              Esta plantilla contiene material protegido. Regeneracion
              requerida.
            </p>
            {safety.replacementTemplateId && (
              <Link
                href={`/templates/${safety.replacementTemplateId}`}
                className="mt-2 inline-block underline"
              >
                Abrir plantilla limpia
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {safety.classification === "suspect" && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Plantilla sospechosa</AlertTitle>
          <AlertDescription>
            <p>
              Esta plantilla requiere revision de originalidad. Regeneracion
              recomendada.
            </p>
            {safety.replacementTemplateId && (
              <Link
                href={`/templates/${safety.replacementTemplateId}`}
                className="mt-2 inline-block underline"
              >
                Abrir plantilla limpia
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {safety.classification === "legacy_unverified" && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Plantilla no verificada</AlertTitle>
          <AlertDescription>
            <p>
              Esta plantilla no ha pasado por el pipeline de verificacion.
            </p>
            {safety.replacementTemplateId && (
              <Link
                href={`/templates/${safety.replacementTemplateId}`}
                className="mt-2 inline-block underline"
              >
                Abrir plantilla verificada
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
