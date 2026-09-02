"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FacilityType = {
  id: string;
  slug: string;
  name: string;
  isGeneric: boolean;
};

type Industry = {
  id: string;
  slug: string;
  name: string;
  facilityTypes: FacilityType[];
};

export function OnboardingForm({ industries }: { industries: Industry[] }) {
  const router = useRouter();
  const [industrySlug, setIndustrySlug] = useState<string | null>(null);
  const [facilityTypeSlug, setFacilityTypeSlug] = useState<string | null>(null);
  const [objectName, setObjectName] = useState("");

  const selectedIndustry = industries.find((i) => i.slug === industrySlug) ?? null;
  const selectedFacility =
    selectedIndustry?.facilityTypes.find((f) => f.slug === facilityTypeSlug) ?? null;

  function handleContinue() {
    if (!facilityTypeSlug) return;
    // M4: on the generic "Other" path, carry the user's free-text object name forward so
    // Steps 2-3 can echo it back ("tailored to what I entered").
    const obj = selectedFacility?.isGeneric ? objectName.trim() : "";
    const query = obj ? `?obj=${encodeURIComponent(obj.slice(0, 80))}` : "";
    router.push(`/compare/${facilityTypeSlug}${query}`);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      {/* This page had no heading of any kind, so screen-reader users landed on the entry
          point of the app with no document outline to orient by (WCAG SC 1.3.1 / 2.4.6). */}
      <h1 className="text-2xl font-semibold">Подбор роботизированного решения</h1>
      <Card>
        <CardHeader>
          <CardTitle as="h2">1. Выберите отрасль</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={industrySlug ?? undefined}
            onValueChange={(value) => {
              setIndustrySlug(value);
              setFacilityTypeSlug(null);
            }}
          >
            {industries.map((industry) => (
              <div key={industry.id} className="flex items-center space-x-2">
                <RadioGroupItem value={industry.slug} id={`industry-${industry.slug}`} />
                <Label htmlFor={`industry-${industry.slug}`}>{industry.name}</Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {selectedIndustry && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">2. Выберите тип объекта</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={facilityTypeSlug ?? undefined}
              onValueChange={setFacilityTypeSlug}
            >
              {selectedIndustry.facilityTypes.map((facilityType) => (
                <div key={facilityType.id} className="flex items-center space-x-2">
                  <RadioGroupItem
                    value={facilityType.slug}
                    id={`facility-${facilityType.slug}`}
                  />
                  <Label htmlFor={`facility-${facilityType.slug}`}>
                    {facilityType.name}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {selectedFacility?.isGeneric && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Название объекта (необязательно)</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              type="text"
              value={objectName}
              maxLength={80}
              placeholder="Например: распределительный центр «Восток»"
              onChange={(e) => setObjectName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Будет показано в расчёте и визуализации.
            </p>
          </CardContent>
        </Card>
      )}

      <Button onClick={handleContinue} disabled={!facilityTypeSlug}>
        Перейти к сравнению решений
      </Button>
    </div>
  );
}
