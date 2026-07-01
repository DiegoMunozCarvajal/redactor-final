import { describe, expect, it } from "vitest";
import { sanitizeForAnthropic, makeOpenAIStrictSchema } from "../schema-sanitizers";

describe("sanitizeForAnthropic", () => {
  it("passes through null/undefined/non-object", () => {
    expect(sanitizeForAnthropic(null as unknown as Record<string, unknown>)).toBe(null);
    expect(sanitizeForAnthropic("string" as unknown as Record<string, unknown>)).toBe("string");
  });

  it("short-circuits on $ref", () => {
    const result = sanitizeForAnthropic({
      $ref: "#/$defs/Foo",
      type: "object",
      properties: { x: { type: "string" } },
    });
    expect(result).toEqual({ $ref: "#/$defs/Foo" });
  });

  it("passes through type, description, title, enum", () => {
    const result = sanitizeForAnthropic({
      type: "string",
      description: "a string",
      title: "Foo",
      enum: ["a", "b"],
    });
    expect(result).toMatchObject({
      type: "string",
      description: "a string",
      title: "Foo",
      enum: ["a", "b"],
    });
  });

  it("converts oneOf to anyOf", () => {
    const result = sanitizeForAnthropic({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
    expect(result).toHaveProperty("anyOf");
    const anyOf = result.anyOf as Record<string, unknown>[];
    expect(anyOf).toHaveLength(2);
    expect(anyOf[0]).toEqual({ type: "string" });
  });

  it("forces additionalProperties false on objects", () => {
    const result = sanitizeForAnthropic({
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: true,
    });
    expect(result.additionalProperties).toBe(false);
  });

  it("preserves required array on objects", () => {
    const result = sanitizeForAnthropic({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(result.required).toEqual(["name"]);
  });

  it("keeps supported string formats", () => {
    const result = sanitizeForAnthropic({ type: "string", format: "email" });
    expect(result.format).toBe("email");
  });

  it("moves unsupported format to description", () => {
    const result = sanitizeForAnthropic({ type: "string", format: "regex" });
    expect(result.format).toBeUndefined();
    expect(result.description).toContain("regex");
  });

  it("limits minItems to 0 or 1", () => {
    const kept = sanitizeForAnthropic({ type: "array", items: { type: "string" }, minItems: 1 });
    expect(kept.minItems).toBe(1);

    const moved = sanitizeForAnthropic({ type: "array", items: { type: "string" }, minItems: 5 });
    expect(moved.minItems).toBeUndefined();
    expect(moved.description).toContain("minItems");
  });

  it("recurses into nested objects", () => {
    const result = sanitizeForAnthropic({
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { inner: { type: "string" } },
        },
      },
    });
    const nested = (result.properties as Record<string, unknown>).nested as Record<string, unknown>;
    expect(nested.additionalProperties).toBe(false);
  });

  it("recurses into $defs", () => {
    const result = sanitizeForAnthropic({
      $defs: { Foo: { type: "object", properties: { x: { type: "string" } } } },
      type: "object",
      properties: {},
    });
    const defs = result.$defs as Record<string, Record<string, unknown>>;
    expect(defs.Foo.additionalProperties).toBe(false);
  });

  it("moves unrecognized keys to description", () => {
    const result = sanitizeForAnthropic({
      type: "string",
      maxLength: 10,
    });
    expect(result.description).toContain("maxLength");
  });
});

describe("makeOpenAIStrictSchema", () => {
  it("passes through null/undefined/non-object", () => {
    expect(makeOpenAIStrictSchema(null as unknown as Record<string, unknown>)).toBe(null);
    expect(makeOpenAIStrictSchema("string" as unknown as Record<string, unknown>)).toBe("string");
  });

  it("adds additionalProperties false to objects", () => {
    const result = makeOpenAIStrictSchema({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(result.additionalProperties).toBe(false);
  });

  it("auto-populates required from property keys", () => {
    const result = makeOpenAIStrictSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    });
    expect(result.required).toEqual(["name", "age"]);
  });

  it("converts nullable true to anyOf with null", () => {
    const result = makeOpenAIStrictSchema({
      type: "string",
      nullable: true,
    });
    expect(result).toHaveProperty("anyOf");
    expect(result.anyOf).toEqual([
      { type: "string" },
      { type: "null" },
    ] as Record<string, unknown>[]);
  });

  it("recurses into nested objects", () => {
    const result = makeOpenAIStrictSchema({
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: { inner: { type: "string" } },
        },
      },
    });
    const nested = (result.properties as Record<string, unknown>).nested as Record<string, unknown>;
    expect(nested.additionalProperties).toBe(false);
    expect(nested.required).toEqual(["inner"]);
  });

  it("recurses into array items", () => {
    const result = makeOpenAIStrictSchema({
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    });
    const items = result.items as Record<string, unknown>;
    expect(items.additionalProperties).toBe(false);
  });

  it("recurses into composition keywords", () => {
    const result = makeOpenAIStrictSchema({
      anyOf: [
        { type: "object", properties: { name: { type: "string" } } },
        { type: "null" },
      ],
    });
    const first = (result.anyOf as Record<string, unknown>[])[0];
    expect(first.additionalProperties).toBe(false);
  });

  it("passes through non-object types", () => {
    const result = makeOpenAIStrictSchema({ type: "string" });
    expect(result).toEqual({ type: "string" });
  });
});
