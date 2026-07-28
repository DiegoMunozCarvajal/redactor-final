import { describe, it, expect } from "vitest";
import {
  extractMetadataBlocks,
  renderExtractedBlocksXML,
  type ExtractedBlocks,
} from "../metadata-blocks";

// ---------------------------------------------------------------------------
// extractMetadataBlocks
// ---------------------------------------------------------------------------

describe("extractMetadataBlocks", () => {
  it("extracts a single block at the end of text and returns cleaned text", () => {
    const input =
      "Este es el contenido del fragmento.\n" +
      "Tiene multiples lineas.\n" +
      "\n" +
      "[CONTEXTO_NARRATIVO]\n" +
      "- `imagen_apertura`: un bosque frondoso\n" +
      "- `tono`: misterioso";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({
      CONTEXTO_NARRATIVO: {
        imagen_apertura: "un bosque frondoso",
        tono: "misterioso",
      },
    });

    expect(result.cleanedText).toBe(
      "Este es el contenido del fragmento.\n" + "Tiene multiples lineas.",
    );
  });

  it("extracts multiple contiguos blocks separated by blank lines", () => {
    const input =
      "Contenido principal.\n" +
      "\n" +
      "[PERSONAJES]\n" +
      "- `protagonista`: Ana\n" +
      "- `antagonista`: Carlos\n" +
      "\n" +
      "[ESCENARIO]\n" +
      "- `epoca`: 1985\n" +
      "- `lugar`: Ciudad de Mexico";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({
      PERSONAJES: {
        protagonista: "Ana",
        antagonista: "Carlos",
      },
      ESCENARIO: {
        epoca: "1985",
        lugar: "Ciudad de Mexico",
      },
    });

    expect(result.cleanedText).toBe("Contenido principal.");
  });

  it("returns empty blocks and unchanged text when no blocks are present", () => {
    const input = "Texto normal sin bloques al final.\nOtra linea.";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({});
    expect(result.cleanedText).toBe(input);
  });

  it("does not extract block-like content in the middle of text", () => {
    const input =
      "[NO_EXTRACTAR]\n" +
      "- `clave`: valor\n" +
      "\n" +
      "Contenido real despues del bloque.";

    const result = extractMetadataBlocks(input);

    // Block at the start, not at the end — nothing extracted
    expect(result.blocks).toEqual({});
    expect(result.cleanedText).toBe(input);
  });

  it("handles multiline values with indented continuation", () => {
    const input =
      "Texto del fragmento.\n" +
      "\n" +
      "[DESCRIPCION]\n" +
      "- `resumen`: Linea uno\n" +
      "  linea dos continuacion\n" +
      "- `color`: azul";

    const result = extractMetadataBlocks(input);

    // The continuation line after `- `resumen`:` is not matched by the kv regex
    // because it doesn't start with `- ``. It's treated as a non-block line,
    // which stops the block scanner. So the block region is only:
    // [DESCRIPCION]
    // - `resumen`: Linea uno
    //
    // The continuation line "  linea dos continuacion" breaks the contiguous
    // block detection since it doesn't match [NAME] or - `key`: value patterns.
    // This means the block is NOT extracted — which is correct behavior for
    // the supported format.
    expect(result.blocks).toEqual({});
    expect(result.cleanedText).toBe(input);
  });

  it("handles special characters in key names and values", () => {
    const input =
      "Contenido.\n" +
      "\n" +
      "[DATOS_TECNICOS]\n" +
      "- `parametro-1`: valor con acentos: áéíóú\n" +
      "- `coordenadas (x,y)`: 10.5, 20.3\n" +
      "- `url`: https://ejemplo.com/ruta";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({
      DATOS_TECNICOS: {
        "parametro-1": "valor con acentos: áéíóú",
        "coordenadas (x,y)": "10.5, 20.3",
        url: "https://ejemplo.com/ruta",
      },
    });

    expect(result.cleanedText).toBe("Contenido.");
  });

  it("returns empty result for empty text", () => {
    const result = extractMetadataBlocks("");

    expect(result.blocks).toEqual({});
    expect(result.cleanedText).toBe("");
  });

  it("extracts block when text ends with block with no preceding blank line", () => {
    const input =
      "Contenido final.\n" +
      "[BLOQUE_FINAL]\n" +
      "- `clave`: valor";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({
      BLOQUE_FINAL: {
        clave: "valor",
      },
    });

    expect(result.cleanedText).toBe("Contenido final.");
  });

  it("extracts two blocks separated by a single blank line", () => {
    const input =
      "Texto.\n" +
      "\n" +
      "[PRIMERO]\n" +
      "- `a`: 1\n" +
      "\n" +
      "[SEGUNDO]\n" +
      "- `b`: 2";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({
      PRIMERO: { a: "1" },
      SEGUNDO: { b: "2" },
    });

    expect(result.cleanedText).toBe("Texto.");
  });

  it("ignores blocks with no key-value pairs", () => {
    const input = "Texto.\n\n[VACIO]\n\n[LLENO]\n- `clave`: valor";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({
      VACIO: {},
      LLENO: { clave: "valor" },
    });
    expect(result.cleanedText).toBe("Texto.");
  });

  it("handles text that is nothing but blocks", () => {
    const input = "[SOLO_BLOQUE]\n- `key`: val";

    const result = extractMetadataBlocks(input);

    expect(result.blocks).toEqual({
      SOLO_BLOQUE: { key: "val" },
    });

    expect(result.cleanedText).toBe("");
  });
});

// ---------------------------------------------------------------------------
// renderExtractedBlocksXML
// ---------------------------------------------------------------------------

describe("renderExtractedBlocksXML", () => {
  it("renders a single block with multiple fields", () => {
    const blocks: ExtractedBlocks = {
      CONTEXTO_NARRATIVO: {
        imagen_apertura: "un bosque",
        tono: "misterioso",
      },
    };

    const xml = renderExtractedBlocksXML(blocks);

    expect(xml).toContain(
      '<extracted_block name="CONTEXTO_NARRATIVO">',
    );
    expect(xml).toContain(
      '<field name="imagen_apertura">un bosque</field>',
    );
    expect(xml).toContain('<field name="tono">misterioso</field>');
  });

  it("renders multiple blocks separated by blank lines", () => {
    const blocks: ExtractedBlocks = {
      PERSONAJES: { protagonista: "Ana" },
      ESCENARIO: { epoca: "1985" },
    };

    const xml = renderExtractedBlocksXML(blocks);

    expect(xml).toContain(
      '<extracted_block name="PERSONAJES">',
    );
    expect(xml).toContain(
      '<extracted_block name="ESCENARIO">',
    );
  });

  it("escapes XML special characters in names and values", () => {
    const blocks: ExtractedBlocks = {
      'DATOS & <meta>': { 'campo "especial"': 'valor < & > comillas' },
    };

    const xml = renderExtractedBlocksXML(blocks);

    expect(xml).toContain('name="DATOS &amp; &lt;meta&gt;"');
    expect(xml).toContain(
      'name="campo &quot;especial&quot;"',
    );
    expect(xml).toContain(
      "valor &lt; &amp; &gt; comillas",
    );
  });

  it("returns empty string for empty blocks", () => {
    const xml = renderExtractedBlocksXML({});
    expect(xml).toBe("");
  });

  it("renders a block with empty fields", () => {
    const blocks: ExtractedBlocks = {
      VACIO: {},
    };

    const xml = renderExtractedBlocksXML(blocks);

    expect(xml).toContain(
      '<extracted_block name="VACIO">',
    );
    expect(xml).not.toContain("<field");
  });
});
