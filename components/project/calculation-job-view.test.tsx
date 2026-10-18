import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { JobReceipt } from "@/lib/calculation-jobs/types";
import { CalculationJobView } from "./calculation-job-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const nonce = "88888888-4444-4444-8444-123456789012";
it("keeps a clear draft recovery path on FAILED and CANCELLED CREATE, without claiming saved inputs live on the server", () => {
  for (const status of ["FAILED", "CANCELLED"] as const) {
    const job = { id: "owned-create", operation: "CREATE", status, publicationState: "NONE", createdAt: "2026-10-18T10:00:00Z",
      attempts: 1, safeMessage: "Расчёт не опубликован", projectId: null } as JobReceipt;
    const html = renderToStaticMarkup(createElement(CalculationJobView, { initial: job, guestDraft: nonce }));
    expect(html).toContain(`href="/projects/new?guestDraft=${nonce}"`);
    expect(html).toContain("Вернуться к гостевому черновику");
    expect(html).toContain("Ошибка и отмена задания не удаляют черновик");
    expect(html).not.toContain("Проект сохранён");
    expect(html).not.toContain("Скачать отправленные параметры");
  }
});
