"use client";

import { Label } from "@/components/ui/label";
import { REGION_PRESETS, regionLaborCostUsd } from "@/lib/economics/regions";
import { formatCost } from "@/lib/format/currency";

export function RegionSelect({
  usdToRub,
  selectedRegionId,
  onPick,
  onClear,
}: {
  usdToRub: number;
  selectedRegionId: string | null;
  onPick: (id: string, laborCostPerHourUsd: number, energyCostFactor: number) => void;
  onClear: () => void;
}) {
  // Derive the selection from the assumptions rather than remembering the last click. The
  // select was uncontrolled, so after picking «Москва» and then editing the labour rate below
  // it kept claiming Москва while the numbers were no longer that region's — the control
  // asserted something the model had stopped agreeing with.
  // The parent owns which region is selected and clears it the moment the user hand-edits a
  // figure the preset set. Matching on the derived USD value instead looked equivalent but was
  // not: the wage is cited in rubles, so changing «Курс USD→RUB» moves the derived value and the
  // match silently evaporated — the selection vanished while the (now-wrong) numbers stayed.
  const selected = selectedRegionId ?? "";

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="region">Регион (труд/энергия)</Label>
      <select
        id="region"
        value={selected}
        className="rounded-md border px-3 py-2 text-sm"
        onChange={(e) => {
          // «— свои значения —» is a real choice, not a no-op. The select became controlled
          // when the parent took ownership of the selection, so bailing out here left
          // selectedRegionId set and React re-rendered the previous region straight back —
          // there was no way to leave a region except by hand-editing the rate it had set.
          if (e.target.value === "") {
            onClear();
            return;
          }
          const r = REGION_PRESETS.find((x) => x.id === e.target.value);
          if (r) onPick(r.id, regionLaborCostUsd(r, usdToRub), r.energyCostFactor);
        }}
      >
        <option value="">— свои значения —</option>
        {REGION_PRESETS.map((r) => (
          <option key={r.id} value={r.id}>
            {/* Show the cited ruble wage, which is the figure the source actually publishes. */}
            {r.name} — ~{formatCost(regionLaborCostUsd(r, usdToRub), usdToRub)}/час
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Подставляет ставку труда и множитель энергозатрат; их можно изменить ниже.
      </p>
    </div>
  );
}
