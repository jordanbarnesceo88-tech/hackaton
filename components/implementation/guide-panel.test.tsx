import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { buildImplementationSnapshot } from "@/lib/implementation/snapshot";
import { ImplementationGuidePanel } from "./guide-panel";

it("exposes class-specific acceptance and sourced service contacts without promising an SLA", () => {
  const html = renderToStaticMarkup(createElement(ImplementationGuidePanel, { snapshot: buildImplementationSnapshot("cleaner", "Pudu"), expanded: true }));
  expect(html).toContain("/knowledge/cleaner");
  expect(html).toContain("долю ручной доработки");
  expect(html).toContain("https://pudurobots.ru/support");
  expect(html).toContain("support@pudurobots.ru");
  expect(html).toContain("срок не опубликован");
  expect(html).toContain("условия обслуживания не подтверждены");
  expect(html).toContain("Контакт ещё не предоставлен");
});
