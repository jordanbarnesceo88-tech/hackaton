import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { acceptedCreateJobId, NewProjectForm } from "./new-project-form";
import { stableJson } from "@/lib/tz/version";
import type { CalculationRequest } from "@/lib/calculation-jobs/service";
import { CalculationClientError } from "@/lib/calculation-jobs/client";

const formMocks = vi.hoisted(() => ({ submit: vi.fn(), push: vi.fn(), state: null as unknown, refs: [] as { current: unknown }[], action: null as null | ((state: unknown, form: FormData) => Promise<unknown>) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: formMocks.push }) }));
vi.mock("@/lib/calculation-jobs/client", async original => ({ ...await original<typeof import("@/lib/calculation-jobs/client")>(), submitCalculation: formMocks.submit }));
vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  return { ...react,
    useRef: (value: unknown) => { const ref = react.useRef(value); formMocks.refs.push(ref); return ref; },
    useActionState: (action: typeof formMocks.action, initial: unknown) => { formMocks.action = action; return [formMocks.state ?? initial, () => {}, false]; },
  };
});

describe("CREATE form validation", () => {
  beforeEach(() => { formMocks.submit.mockReset(); formMocks.push.mockReset(); formMocks.action = null; formMocks.state = null; formMocks.refs = []; });
  it.each(["manual", "demo", "upload"])("rejects blank/oversized names locally for %s instead of sending a 422 request", async source => {
    renderToStaticMarkup(createElement(NewProjectForm));
    const focus = vi.fn(); formMocks.refs[2]!.current = { focus };
    for (const name of ["", " \t\n ", "я".repeat(121)]) {
      const data = new FormData();
      for (const [key, value] of Object.entries({ source, name, facility: "warehouse", paramsJson: "{}", fileName: "параметры.csv" })) data.set(key, value);
      expect(await formMocks.action!({ error: null }, data)).toEqual({ error: "Название проекта — от 1 до 120 символов" });
    }
    expect(formMocks.submit).not.toHaveBeenCalled();
    expect(formMocks.push).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(3);
  });
  it.each(["manual", "demo", "upload"])("submits %s base inputs unchanged with a valid name", async source => {
    formMocks.submit.mockResolvedValue({ id: "accepted" });
    renderToStaticMarkup(createElement(NewProjectForm));
    const data = new FormData();
    for (const [key, value] of Object.entries({ source, name: "Склад А", facility: "warehouse", paramsJson: "{}", fileName: "параметры.csv" })) data.set(key, value);
    expect(await formMocks.action!({ error: null }, data)).toEqual({ error: null });
    expect(formMocks.submit).toHaveBeenCalledWith({ operation: "CREATE", name: "Склад А", objectName: "", facility: "warehouse", ...(source === "upload" ? { params: {} } : {}), paramsSource: { kind: source, ...(source === "upload" ? { fileName: "параметры.csv" } : {}) } }, "create-project");
    expect(formMocks.push).toHaveBeenCalledWith("/calculation-jobs/accepted?open=1");
  });
  it.each(["QUEUE_FULL", "HISTORY_FULL", undefined])("offers active jobs only for a specific queue error (%s), without resubmitting", async code => {
    formMocks.submit.mockRejectedValue(new CalculationClientError(429, "Не принято", code));
    renderToStaticMarkup(createElement(NewProjectForm));
    const data = new FormData(); data.set("name", "Не потерять название"); data.set("source", "manual");
    const state = await formMocks.action!({ error: null }, data);
    expect(state).toEqual({ error: "Не принято", ...(code === "QUEUE_FULL" ? { queueFull: true } : {}) });
    formMocks.state = state;
    const html = renderToStaticMarkup(createElement(NewProjectForm));
    expect(html.includes('href="/calculation-jobs"')).toBe(code === "QUEUE_FULL");
    if (code === "QUEUE_FULL") expect(html).toContain("Открыть активные расчёты");
    expect(formMocks.submit).toHaveBeenCalledOnce();
    expect(formMocks.submit.mock.calls[0]![0].name).toBe("Не потерять название");
    expect(formMocks.push).not.toHaveBeenCalled();
  });
});

describe("CREATE acknowledgement routing", () => {
  const original: CalculationRequest = { operation: "CREATE", name: "Склад А", facility: "warehouse", paramsSource: { kind: "demo" } };
  const accepted = { inputKey: stableJson(original), id: "known-job" };

  it("reopens the known operation for the same form, including reordered JSON keys", () => {
    expect(acceptedCreateJobId({ paramsSource: { kind: "demo" }, facility: "warehouse", name: "Склад А", operation: "CREATE" }, accepted)).toBe("known-job");
    expect(acceptedCreateJobId(original, null)).toBeNull();
  });

  it("does not route edited names, objects, facilities, sources or uploaded inputs into the previous job", () => {
    for (const edited of [
      { ...original, name: "Склад Б" }, { ...original, objectName: "Другой объект" },
      { ...original, facility: "airport" }, { ...original, paramsSource: { kind: "manual" as const } },
      { ...original, paramsSource: { kind: "upload" as const, fileName: "объект.csv" }, params: { activeAreaM2: 3000 } },
    ]) expect(acceptedCreateJobId(edited, accepted)).toBeNull();
  });
});
