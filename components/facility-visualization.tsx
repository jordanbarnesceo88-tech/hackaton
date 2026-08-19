"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateLayout } from "@/lib/scene/layout";
import { spawnRobots, stepRobots } from "@/lib/scene/simulate";
import { deployedCapacity, utilizationPct, roiAccrued } from "@/lib/scene/kpi";
import { formatCost } from "@/lib/format/currency";
import type { FacilityKind, RobotState } from "@/lib/scene/types";
import type {
  SolutionCapacity,
  FacilityParams,
  AssumptionValues,
  EconomicsResult,
} from "@/lib/economics/types";

const MAX_RENDERED = 24;
const LOOP_MS = 20000;
const ZONE_COLORS: Record<string, string> = {
  rack: "#94a3b8", gate: "#a5b4fc", belt: "#fbbf24", room: "#86efac",
  zone: "#93c5fd", dock: "#f472b6",
};

export function FacilityVisualization({
  facilityKind,
  params,
  assumptions,
  capacity,
  capacityUnit,
  result,
}: {
  facilityKind: FacilityKind;
  params: FacilityParams;
  assumptions: AssumptionValues;
  capacity: SolutionCapacity;
  capacityUnit: string;
  result: EconomicsResult;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const robotsRef = useRef<RobotState[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const renderCount = Math.max(1, Math.min(MAX_RENDERED, Math.floor(result.quantity)));
  const overflow = result.quantity > MAX_RENDERED;

  const layout = useMemo(
    () => generateLayout(facilityKind, params),
    [facilityKind, params]
  );

  // (Re)spawn robots when the layout or render count changes.
  useEffect(() => {
    robotsRef.current = spawnRobots(layout, renderCount);
  }, [layout, renderCount]);

  // Animation loop: advance + draw each frame; pause when tab hidden.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    const start = performance.now();
    // speed scales mildly with utilization/throughput but stays bounded.
    const speed = 0.15;

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(now - last, 100); // clamp dt (e.g. after tab refocus)
      last = now;

      robotsRef.current = stepRobots(robotsRef.current, dt, speed);
      setElapsed(now - start);

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, W, H);

      for (const z of layout.zones) {
        ctx.fillStyle = ZONE_COLORS[z.kind] ?? "#64748b";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(z.x * W, z.y * H, z.w * W, z.h * H);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "#22d3ee";
      for (const r of robotsRef.current) {
        ctx.beginPath();
        ctx.arc(r.pos.x * W, r.pos.y * H, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [layout]);

  const util = utilizationPct(capacity, params, assumptions, result.quantity);
  const deployed = deployedCapacity(result.quantity, capacity.capacityPerUnit);
  const savings = result.economical ? result.annualSavingsUsd : 0;
  const accrued = result.economical ? roiAccrued(elapsed, LOOP_MS, savings) : 0;
  const accruedFrac = savings > 0 ? accrued / savings : 0;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Визуализация работы роботов</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={720}
            height={360}
            className="w-full rounded-md border"
            style={{ aspectRatio: "2 / 1" }}
          />
          {overflow && (
            <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
              показано {MAX_RENDERED} из {result.quantity}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div>
            Роботов в работе: <b>{renderCount}</b>
            {overflow ? ` (всего ${result.quantity})` : ""}
          </div>
          <div>
            Производительность: <b>{deployed.toLocaleString("ru-RU")} {capacityUnit}</b>
          </div>
          <div>Загрузка: <b>{util.toFixed(0)}%</b></div>
          <div>
            <div className="mb-1">Накопленная экономия (за год):</div>
            {result.economical ? (
              <>
                <div className="h-3 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-100"
                    style={{ width: `${Math.round(accruedFrac * 100)}%` }}
                  />
                </div>
                <div className="mt-1 font-medium">{formatCost(accrued)}</div>
              </>
            ) : (
              <div className="font-medium text-red-600">
                Решение не окупается — экономия не накапливается
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
