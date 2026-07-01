import { describe, it, expect } from "vitest";
import {
  getModelDefinition,
  requireModelDefinition,
  getProviderForModel,
  getModelPricing,
  AVAILABLE_MODELS,
  MODEL_OPTIONS,
  MODELS_BY_STAGE,
  DEFAULT_GENERATION_MODEL,
} from "@/lib/ai/providers";

describe("providers", () => {
  // ---------------------------------------------------------------------------
  // Model catalog
  // ---------------------------------------------------------------------------

  describe("AVAILABLE_MODELS", () => {
    it("contains exactly 3 models", () => {
      expect(AVAILABLE_MODELS).toHaveLength(3);
    });

    it("each model has required fields", () => {
      for (const m of AVAILABLE_MODELS) {
        expect(m).toHaveProperty("id");
        expect(m).toHaveProperty("label");
        expect(m).toHaveProperty("provider");
        expect(m).toHaveProperty("pricing");
        expect(m.pricing).toHaveProperty("input");
        expect(m.pricing).toHaveProperty("output");
        expect(typeof m.pricing.input).toBe("number");
        expect(typeof m.pricing.output).toBe("number");
      }
    });

    it("has unique model IDs", () => {
      const ids = AVAILABLE_MODELS.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("GPT 5.5 has fixedTemperature of 1", () => {
      const gpt = AVAILABLE_MODELS.find((m) => m.id === "gpt-5.5");
      expect(gpt).toBeDefined();
      expect(gpt!.fixedTemperature).toBe(1);
    });

    it("Claude Opus has no fixedTemperature", () => {
      const claude = AVAILABLE_MODELS.find((m) => m.id === "claude-opus-4-8");
      expect(claude).toBeDefined();
      expect(claude!.fixedTemperature).toBeUndefined();
    });
  });

  describe("DEFAULT_GENERATION_MODEL", () => {
    it("is in AVAILABLE_MODELS", () => {
      expect(AVAILABLE_MODELS.find((m) => m.id === DEFAULT_GENERATION_MODEL)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Model lookups
  // ---------------------------------------------------------------------------

  describe("getModelDefinition", () => {
    it("returns the model for a known ID", () => {
      const def = getModelDefinition("gpt-5.5");
      expect(def).toBeDefined();
      expect(def!.provider).toBe("openai");
    });

    it("returns undefined for an unknown ID", () => {
      expect(getModelDefinition("nonexistent-model")).toBeUndefined();
    });
  });

  describe("requireModelDefinition", () => {
    it("returns the model for a known ID", () => {
      const def = requireModelDefinition("deepseek-v4-pro");
      expect(def.provider).toBe("deepseek");
    });

    it("throws for an unknown ID", () => {
      expect(() => requireModelDefinition("fake-model-123")).toThrow(
        'Unknown model: "fake-model-123"',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Provider routing
  // ---------------------------------------------------------------------------

  describe("getProviderForModel", () => {
    it("returns openai for gpt-5.5", () => {
      expect(getProviderForModel("gpt-5.5")).toBe("openai");
    });

    it("returns anthropic for claude-opus-4-8", () => {
      expect(getProviderForModel("claude-opus-4-8")).toBe("anthropic");
    });

    it("returns deepseek for deepseek-v4-pro", () => {
      expect(getProviderForModel("deepseek-v4-pro")).toBe("deepseek");
    });

    it("throws for unknown model", () => {
      expect(() => getProviderForModel("unknown")).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Pricing (per-token, not per-million)
  // ---------------------------------------------------------------------------

  describe("getModelPricing", () => {
    it("returns per-token prices (divided by 1M)", () => {
      // GPT 5.5: $2.75 / 1M input = $0.00000275 per token
      const pricing = getModelPricing("gpt-5.5");
      expect(pricing.input).toBe(2.75 / 1_000_000);
      expect(pricing.output).toBe(16.5 / 1_000_000);
    });

    it("returns correct Anthropic pricing", () => {
      const pricing = getModelPricing("claude-opus-4-8");
      expect(pricing.input).toBe(15 / 1_000_000);
      expect(pricing.output).toBe(75 / 1_000_000);
    });

    it("returns correct DeepSeek pricing", () => {
      const pricing = getModelPricing("deepseek-v4-pro");
      expect(pricing.input).toBe(1.74 / 1_000_000);
      expect(pricing.output).toBe(3.48 / 1_000_000);
    });

    it("throws for unknown model", () => {
      expect(() => getModelPricing("unknown")).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Derived exports
  // ---------------------------------------------------------------------------

  describe("MODEL_OPTIONS", () => {
    it("has one entry per AVAILABLE_MODEL", () => {
      expect(MODEL_OPTIONS).toHaveLength(AVAILABLE_MODELS.length);
    });

    it("each entry has id and label", () => {
      for (const opt of MODEL_OPTIONS) {
        expect(opt).toHaveProperty("id");
        expect(opt).toHaveProperty("label");
      }
    });
  });

  describe("MODELS_BY_STAGE", () => {
    it("each stage references AVAILABLE_MODELS", () => {
      for (const [stage, models] of Object.entries(MODELS_BY_STAGE)) {
        expect(models, `stage ${stage} should have models`).toBe(AVAILABLE_MODELS);
      }
    });

    it("covers all expected pipeline stages", () => {
      const stages = Object.keys(MODELS_BY_STAGE);
      expect(stages).toContain("book_plan");
      expect(stages).toContain("draft_small_book");
      expect(stages).toContain("critique_revise");
      expect(stages).toContain("book_title");
    });
  });
});
