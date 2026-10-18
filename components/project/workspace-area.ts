import type { ParamValues } from "@/lib/tz/types";

export function workspaceAreaContext(facility: string, params: ParamValues, activeAreaM2?: number | null): { label: string; areaM2: number | null } {
  const key = facility === "airport" ? "terminalAreaM2" : facility === "medical" ? "totalAreaM2" : "activeAreaM2";
  const raw = facility === "warehouse" && activeAreaM2 != null ? activeAreaM2 : params[key];
  const area = typeof raw === "number" || typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return { label: facility === "airport" ? "Площадь терминала" : facility === "medical" ? "Площадь объекта" : "Активная зона",
    areaM2: Number.isFinite(area) && area > 0 ? area : null };
}
