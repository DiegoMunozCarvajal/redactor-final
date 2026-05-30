import { describe, expect, it } from "vitest";

import {
  extractPlaceholders,
  getMissingPlaceholderNames,
  getPlaceholderNamesToDelete,
} from "@/lib/placeholder-utils";

describe("placeholders", () => {
  it("ignores double-brace assembly markers", () => {
    expect(
      extractPlaceholders([
        "{TEMA_DEL_LIBRO} {{SECCIONES_GENERADAS}} {TONO_DEL_LIBRO}",
      ]),
    ).toEqual(["TEMA_DEL_LIBRO", "TONO_DEL_LIBRO"]);
  });

  it("keeps existing placeholder rows that carry user data", () => {
    expect(
      getPlaceholderNamesToDelete(
        [
          { name: "BORRABLE" },
          { name: "CON_DEFINICION", definition: "valor" },
          { name: "CON_FUNCION", function: "rol narrativo" },
          { name: "CON_NOTAS", notes: "nota" },
          { name: "DETECTADO" },
        ],
        ["DETECTADO"],
      ),
    ).toEqual(["BORRABLE"]);
  });

  it("reports placeholders without definitions", () => {
    expect(
      getMissingPlaceholderNames(
        ["{TEMA_DEL_LIBRO} {ESTUDIO_CLAVE} {{SECCIONES_GENERADAS}}"],
        { TEMA_DEL_LIBRO: "Hábitos" },
      ),
    ).toEqual(["ESTUDIO_CLAVE"]);
  });
});
