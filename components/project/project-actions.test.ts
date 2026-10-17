import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectToolbar } from "./project-toolbar";
import { VersionBanner } from "./version-banner";

vi.mock("@/lib/projects/actions", () => ({
  copyProjectAction: vi.fn(),
  deleteProjectAction: vi.fn(),
  saveProjectAction: vi.fn(),
  recalcProjectAction: vi.fn(),
}));

const stored = { modelVersion: "older-model", dataVersion: "older-data", calculatedAt: "2026-10-16T08:00:00Z" };

describe("saved project actions", () => {
  it("does not expose any server export URL while the project is dirty", () => {
    const html = renderToStaticMarkup(createElement(ProjectToolbar, {
      mode: "owner", projectId: "p1", projectName: "Склад", dirty: true,
    }));
    for (const label of ["Отчёт (PDF)", "Excel", "CSV"]) {
      const button = html.match(new RegExp(`<button[^>]*>\\s*${label.replace(/[()]/g, "\\$&")}\\s*</button>`))?.[0];
      expect(button, label).toContain('disabled=""');
      expect(button, label).toContain("aria-describedby=");
    }
    expect(html).not.toContain('href="/projects/p1/report"');
    expect(html).not.toContain('href="/projects/p1/export.');
    expect(html).toContain("Отчёт (PDF), Excel и CSV строятся по сохранённому расчёту: сначала сохраните проект.");
  });

  it("keeps all server export links available for a clean project", () => {
    const html = renderToStaticMarkup(createElement(ProjectToolbar, {
      mode: "owner", projectId: "p1", projectName: "Склад", dirty: false,
    }));
    for (const suffix of ["report", "export.xlsx", "export.csv"]) {
      expect(html).toContain(`href="/projects/p1/${suffix}"`);
    }
  });

  it("blocks live-data recalculation and explains how to keep local changes", () => {
    const html = renderToStaticMarkup(createElement(VersionBanner, {
      projectId: "p1", stored, liveDataVersion: "new-data", dirty: true,
    }));
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*aria-describedby=/);
    expect(html).toContain("Есть несохранённые изменения. Сначала сохраните проект");
  });

  it("allows recalculation after the project becomes clean", () => {
    const html = renderToStaticMarkup(createElement(VersionBanner, {
      projectId: "p1", stored, liveDataVersion: "new-data", dirty: false,
    }));
    expect(html).toContain("Пересчитать на актуальных данных");
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("preserves the existing demo/read-only restriction", () => {
    const html = renderToStaticMarkup(createElement(VersionBanner, {
      projectId: "p1", stored, liveDataVersion: "new-data", dirty: false,
      disabledReason: "Режим чтения: пересчёт недоступен.",
    }));
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain("Режим чтения: пересчёт недоступен.");
  });
});
