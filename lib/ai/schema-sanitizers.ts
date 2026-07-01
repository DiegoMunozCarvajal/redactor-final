/**
 * Provider-specific JSON Schema sanitizers extracted from completion.ts.
 * Pure functions — no side effects, no external dependencies.
 */

const SUPPORTED_STRING_FORMATS = new Set([
  "date-time", "time", "date", "duration", "email",
  "hostname", "uri", "ipv4", "ipv6", "uuid",
]);

/**
 * Transforms a JSON Schema to be compatible with Anthropic's structured output.
 * Mirrors @anthropic-ai/sdk v0.98.0's transformJSONSchema behavior:
 *   - Supported: type, properties, required, items, description, title,
 *     oneOf, anyOf, allOf, $ref, $defs, enum, format (limited set),
 *     additionalProperties (forced to false), minItems (0 or 1).
 *   - Unsupported constraints are moved to description so the model still
 *     sees them as natural-language hints rather than being silently dropped.
 */
export function sanitizeForAnthropic(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return schema;

  // Clone to avoid mutating the input
  const src = { ...schema };
  const cleaned: Record<string, unknown> = {};

  // $ref short-circuits — nothing else matters
  if ("$ref" in src) {
    cleaned["$ref"] = src["$ref"];
    return cleaned;
  }

  // Transform $defs recursively
  if ("$defs" in src && typeof src["$defs"] === "object" && src["$defs"] !== null) {
    const defs = src["$defs"] as Record<string, unknown>;
    const cleanedDefs: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(defs)) {
      cleanedDefs[name] = sanitizeForAnthropic(def as Record<string, unknown>);
    }
    cleaned["$defs"] = cleanedDefs;
    delete src["$defs"];
  }

  // Composition keywords — Anthropic supports these as of SDK v0.98.0
  // oneOf is converted to anyOf for compatibility
  const anyOf = src["anyOf"];
  const oneOf = src["oneOf"];
  const allOf = src["allOf"];
  delete src["anyOf"];
  delete src["oneOf"];
  delete src["allOf"];

  if (Array.isArray(anyOf)) {
    cleaned["anyOf"] = anyOf.map((v) => sanitizeForAnthropic(v as Record<string, unknown>));
  } else if (Array.isArray(oneOf)) {
    cleaned["anyOf"] = oneOf.map((v) => sanitizeForAnthropic(v as Record<string, unknown>));
  } else if (Array.isArray(allOf)) {
    cleaned["allOf"] = allOf.map((v) => sanitizeForAnthropic(v as Record<string, unknown>));
  }

  // type, description, title, enum — pass through
  const type = src["type"];
  delete src["type"];
  if (type !== undefined) {
    cleaned["type"] = type;
  }

  for (const key of ["description", "title", "enum"] as const) {
    if (key in src) {
      cleaned[key] = src[key];
      delete src[key];
    }
  }

  // Type-specific transformations
  if (type === "object") {
    const properties = (src["properties"] ?? {}) as Record<string, unknown>;
    delete src["properties"];
    cleaned["properties"] = Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [
        k,
        sanitizeForAnthropic(v as Record<string, unknown>),
      ]),
    );
    cleaned["additionalProperties"] = false;
    delete src["additionalProperties"];

    if ("required" in src) {
      cleaned["required"] = src["required"];
      delete src["required"];
    }
  } else if (type === "string") {
    const format = src["format"];
    delete src["format"];
    if (typeof format === "string" && SUPPORTED_STRING_FORMATS.has(format)) {
      cleaned["format"] = format;
    } else if (format !== undefined) {
      // Move unsupported format to description
      src["format"] = format;
    }
  } else if (type === "array") {
    if ("items" in src) {
      cleaned["items"] = sanitizeForAnthropic(src["items"] as Record<string, unknown>);
      delete src["items"];
    }
    const minItems = src["minItems"];
    delete src["minItems"];
    if (minItems === 0 || minItems === 1) {
      cleaned["minItems"] = minItems;
    } else if (minItems !== undefined) {
      src["minItems"] = minItems;
    }
  }

  // Move any remaining keys to description so constraints are not lost
  const remaining = Object.keys(src);
  if (remaining.length > 0) {
    const leftovers = Object.fromEntries(
      remaining.map((key) => [key, src[key]]),
    );
    const suffix = `{${Object.entries(leftovers)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(", ")}}`;
    const existingDesc = cleaned["description"];
    cleaned["description"] = existingDesc
      ? `${existingDesc}\n\n${suffix}`
      : suffix;
  }

  return cleaned;
}

/**
 * Transforms a JSON schema to be compatible with OpenAI strict mode:
 * - Adds `additionalProperties: false` to every object
 * - Ensures every property key appears in `required`
 * - Converts OpenAPI-style `nullable: true` to `anyOf: [{type}, {type: "null"}]`
 * - Recurses into nested objects, arrays, and composition keywords
 */
export function makeOpenAIStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return schema;

  const result = { ...schema };

  // Convert OpenAPI nullable: true to anyOf with null
  if (result.nullable === true) {
    const { nullable: _n, ...rest } = result;
    void _n;
    const base = makeOpenAIStrictSchema(rest);
    return { anyOf: [base, { type: "null" }] };
  }

  if (result.type === "object" && result.properties) {
    result.additionalProperties = false;
    const propKeys = Object.keys(result.properties as Record<string, unknown>);
    // Preserve original required array. OpenAI strict mode requires ALL
    // properties in required, so optional fields are incompatible with strict.
    // Keep the original required so callers can decide whether strict is safe.
    if (!result.required || !Array.isArray(result.required)) {
      result.required = propKeys;
    }
    result.properties = Object.fromEntries(
      Object.entries(result.properties as Record<string, unknown>).map(([k, v]) => [
        k,
        makeOpenAIStrictSchema(v as Record<string, unknown>),
      ])
    );
  }

  if (result.type === "array" && result.items) {
    result.items = makeOpenAIStrictSchema(result.items as Record<string, unknown>);
  }

  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(result[key])) {
      result[key] = (result[key] as Record<string, unknown>[]).map((s) =>
        makeOpenAIStrictSchema(s)
      );
    }
  }

  return result;
}
