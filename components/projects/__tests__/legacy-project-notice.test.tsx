// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProjectSafetyBanner } from "@/components/projects/project-safety-banner";

describe("ProjectSafetyBanner", () => {
  afterEach(() => {
    cleanup();
  });
  it("shows legacy read-only notice with replacement link", () => {
    render(
      <ProjectSafetyBanner
        safety={{
          state: "legacy_read_only",
          replacementProjectId: "abc-123",
        }}
      />,
    );
    expect(screen.getByTestId("project-safety-banner")).toBeDefined();
    expect(
      screen.getByText("Proyecto legacy: solo lectura"),
    ).toBeDefined();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/projects/abc-123");
  });

  it("shows legacy read-only notice without replacement link", () => {
    render(
      <ProjectSafetyBanner
        safety={{
          state: "legacy_read_only",
        }}
      />,
    );
    expect(
      screen.getByText("Proyecto legacy: solo lectura"),
    ).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows source-free notice", () => {
    render(
      <ProjectSafetyBanner
        safety={{
          state: "source_free",
        }}
      />,
    );
    expect(
      screen.getByText("Proyecto sin fuentes protegidas"),
    ).toBeDefined();
  });

  it("renders nothing for clean_v2 projects", () => {
    const { container } = render(
      <ProjectSafetyBanner
        safety={{
          state: "clean_v2",
        }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
