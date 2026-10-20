import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { cleaningWorkingProfile } from "@/lib/data/cleaning-assumptions";
import { CleaningProfileEditor } from "./cleaning-profile";
import { CostPackageEditor } from "./cost-package";
import { RaasPackageEditor } from "./raas-package";
import { draftChecked, draftText, editorDraftFromData, editorDraftIdentity, withoutScenarioEditorDrafts } from "./editor-draft";

describe("workspace structured-editor drafts", () => {
  it("isolates every workspace/scenario/product/section/accepted-value boundary but tolerates JSON key order", () => {
    const base = ["project-a", "warehouse", "purchase", "cleaning", "pudu-cc1", "cleaningProfile", { windowH: 8, source: "team" }] as const;
    const identity = editorDraftIdentity(...base);
    expect(editorDraftIdentity(...base.slice(0, 6) as [string, string, string, string, string, "cleaningProfile"], { source: "team", windowH: 8 })).toBe(identity);
    const alternatives: Parameters<typeof editorDraftIdentity>[] = [
      [undefined, ...base.slice(1)] as Parameters<typeof editorDraftIdentity>,
      ["project-b", ...base.slice(1)] as Parameters<typeof editorDraftIdentity>,
      [base[0], "hotel", ...base.slice(2)] as Parameters<typeof editorDraftIdentity>,
      [base[0], base[1], "raas", ...base.slice(3)] as Parameters<typeof editorDraftIdentity>,
      [base[0], base[1], base[2], "transport", ...base.slice(4)] as Parameters<typeof editorDraftIdentity>,
      [base[0], base[1], base[2], base[3], "agibot-c5", base[5], base[6]],
      [base[0], base[1], base[2], base[3], base[4], "costPackage", base[6]],
      [base[0], base[1], base[2], base[3], base[4], base[5], { windowH: 12, source: "team" }],
    ];
    for (const alternative of alternatives) expect(editorDraftIdentity(...alternative)).not.toBe(identity);
  });

  it("records unchecked false instead of restoring accepted true, and keeps blank/zero fields and mode/basis", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ "startup-mode": "separate", "startup-amount": "0", "startup-basis": "per-site", reason: "", software: "on" })) data.set(key, value);
    const draft = editorDraftFromData(data, [{ name: "software", checked: true }, { name: "allChargers", checked: false }, { name: "repair", checked: false }]);
    expect(draft).toEqual({ "startup-mode": "separate", "startup-amount": "0", "startup-basis": "per-site", reason: "", software: true, allChargers: false, repair: false });
    expect(draftChecked(draft, "allChargers", true)).toBe(false);
    expect(draftChecked(undefined, "allChargers", true)).toBe(true);
    expect(draftText(draft, "reason", "accepted")).toBe("");
    expect(draftText(draft, "startup-amount", 100)).toBe("0");
  });

  it("does not resurrect deleted drafts when a new scenario reuses the same key", () => {
    const identity = (scenario: string, section: "cleaningProfile" | "costPackage", accepted?: unknown, project = "a", facility = "warehouse") => editorDraftIdentity(project, facility, scenario, "cleaning", "pudu-cc1", section, accepted);
    const removed = [identity("p2", "cleaningProfile"), identity("p2", "cleaningProfile", { windowH: 8 }), identity("p2", "costPackage")];
    const kept = [identity("purchase", "cleaningProfile"), identity("p2", "cleaningProfile", undefined, "b"), identity("p2", "cleaningProfile", undefined, "a", "hotel")];
    const drafts = Object.fromEntries([...removed, ...kept].map(key => [key, { reason: "local draft" }]));
    const afterDelete = withoutScenarioEditorDrafts(drafts, "a", "warehouse", "p2");
    expect(Object.keys(afterDelete).sort()).toEqual(kept.sort());
    expect(afterDelete[identity("p2", "cleaningProfile")]).toBeUndefined();
    expect(Object.keys(drafts)).toHaveLength(6);
  });

  it("restores only unapplied cleaning form values without changing the accepted summary or applying them", () => {
    const value = cleaningWorkingProfile("pudu-cc1")!;
    const onChange = vi.fn(), onDraftChange = vi.fn();
    const html = renderToStaticMarkup(createElement(CleaningProfileEditor, {
      productSlug: "pudu-cc1", value, draft: { windowH: "12", reason: "Purchase draft only" }, onChange, onDraftChange,
    }));
    expect(html).toMatch(/name="windowH"[^>]*value="12"/);
    expect(html).toContain("Purchase draft only");
    expect(html).toContain("ранее принятый профиль");
    expect(html).toContain("2 200");
    expect(onChange).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
    const readonly = renderToStaticMarkup(createElement(CleaningProfileEditor, { productSlug: "pudu-cc1", value, readOnly: true, draft: { reason: "Unapplied secret", windowH: "12" }, onChange, onDraftChange }));
    expect(readonly).not.toContain("Unapplied secret");
    expect(readonly).not.toContain("<input");
  });

  it("restores a cost package draft including false checkboxes and changed charge mode/amount/basis", () => {
    const props = { chargers: 5, value: { softwareIncludedInIntegration: true, repairsIncludedInService: true, allChargersIncluded: true, includedChargers: 0, reason: "Accepted scope" }, onChange: vi.fn(), draft: { allChargers: false, software: false, repair: false, chargers: "2", "startup-mode": "separate", "startup-amount": "12345", "startup-basis": "per-site", reason: "Unapplied scope" } };
    const html = renderToStaticMarkup(createElement(CostPackageEditor, props));
    for (const name of ["allChargers", "software", "repair"]) expect(html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0]).not.toContain("checked");
    expect(html).toMatch(/name="chargers"[^>]*value="2"/);
    expect(html).toMatch(/name="startup-amount"[^>]*value="12345"/);
    expect(html).toContain('value="per-site" selected=""');
    expect(html).toContain("Unapplied scope");
    expect(html).toContain("Accepted scope");
    expect(props.onChange).not.toHaveBeenCalled();
    const readonly = renderToStaticMarkup(createElement(CostPackageEditor, { ...props, readOnly: true }));
    expect(readonly).not.toContain("Unapplied scope");
    expect(readonly).not.toContain("<input");
  });

  it("restores RaaS first month, separate battery periods and source without adopting a draft as accepted", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(createElement(RaasPackageEditor, { recurringRubMonth: 1000, onChange,
      draft: { firstMonth: "2000", "battery-mode": "separate", "battery-amount": "42000", "battery-basis": "per-site", "battery-years": "3", reason: "Draft quote" },
    }));
    expect(html).toMatch(/name="firstMonth"[^>]*value="2000"/);
    expect(html).toMatch(/name="battery-amount"[^>]*value="42000"/);
    expect(html).toMatch(/name="battery-years"[^>]*value="3"/);
    expect(html).toContain('value="per-site" selected=""');
    expect(html).toContain("Draft quote");
    expect(html).toContain("состав предложения не задан");
    expect(onChange).not.toHaveBeenCalled();
    const readonly = renderToStaticMarkup(createElement(RaasPackageEditor, { recurringRubMonth: 1000, onChange, readOnly: true, draft: { reason: "Draft quote" } }));
    expect(readonly).not.toContain("Draft quote");
    expect(readonly).not.toContain("<input");
  });
});
