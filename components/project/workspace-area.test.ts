import { expect, it } from "vitest";
import { workspaceAreaContext } from "./workspace-area";
it("shows the facility's actual area instead of zero or another process's area", () => {
  const params = { totalAreaM2: 45000, terminalAreaM2: 85000, activeAreaM2: 5000 };
  expect(workspaceAreaContext("airport", params, 123)).toEqual({ label: "Площадь терминала", areaM2: 85000 });
  expect(workspaceAreaContext("medical", params)).toEqual({ label: "Площадь объекта", areaM2: 45000 });
  expect(workspaceAreaContext("warehouse", params, 4700)).toEqual({ label: "Активная зона", areaM2: 4700 });
  expect(workspaceAreaContext("warehouse", params).areaM2).toBe(5000);
  for (const raw of [undefined, null, "", "oops", 0, -1, NaN]) expect(workspaceAreaContext("airport", { terminalAreaM2: raw } as never).areaM2).toBeNull();
});
