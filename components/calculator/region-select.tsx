"use client";

import { Label } from "@/components/ui/label";
import { REGION_PRESETS } from "@/lib/economics/regions";
import { formatCost } from "@/lib/format/currency";

export function RegionSelect({
  usdToRub,
  laborCostPerHourUsd,
  energyCostFactor,
  onPick,
}: {
  usdToRub: number;
  laborCostPerHourUsd: number;
  energyCostFactor: number;
  onPick: (laborCostPerHourUsd: number, energyCostFactor: number) => void;
}) {
  // Derive the selection from the assumptions rather than remembering the last click. The
  // select was uncontrolled, so after picking «Москва» and then editing the labour rate below
  // it kept claiming Москва while the numbers were no longer that region's — the control
  // asserted something the model had stopped agreeing with.
  const selected =
    REGION_PRESETS.find(
      (r) =>
        r.laborCostPerHourUsd === laborCostPerHourUsd && r.energyCostFactor === energyCostFactor
    )?.id ?? "";

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="region">Регион (труд/энергия)</Label>
      <select
        id="region"
        value={selected}
        className="rounded-md border px-3 py-2 text-sm"
        onChange={(e) => {
          const r = REGION_PRESETS.find((x) => x.id === e.target.value);
          if (r) onPick(r.laborCostPerHourUsd, r.energyCostFactor);
        }}
      >
        <option value="">— свои значения —</option>
        {REGION_PRESETS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} — ~{formatCost(r.laborCostPerHourUsd, usdToRub)}/час
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Подставляет ставку труда и множитель энергозатрат; их можно изменить ниже.
      </p>
    </div>
  );
}
