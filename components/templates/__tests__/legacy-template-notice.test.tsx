// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TemplateSafetyBanner } from "@/components/templates/template-safety-banner";

describe("TemplateSafetyBanner", () => {
  it("shows legacy_unverified notice", () => {
    render(
      <TemplateSafetyBanner
        safety={{ classification: "legacy_unverified" }}
      />,
    );
    expect(screen.getByText(/no verificada/i)).toBeDefined();
  });

  it("shows suspect notice", () => {
    render(
      <TemplateSafetyBanner safety={{ classification: "suspect" }} />,
    );
    expect(screen.getByText(/sospechosa/i)).toBeDefined();
  });

  it("shows contaminated notice", () => {
    render(
      <TemplateSafetyBanner safety={{ classification: "contaminated" }} />,
    );
    expect(screen.getByText(/contaminada/i)).toBeDefined();
  });

  it("renders nothing for clean_v2", () => {
    const { container } = render(
      <TemplateSafetyBanner safety={{ classification: "clean_v2" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows replacement template link when available", () => {
    render(
      <TemplateSafetyBanner
        safety={{
          classification: "contaminated",
          replacementTemplateId: "tmpl-456",
        }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/templates/tmpl-456");
  });
});
