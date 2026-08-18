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

  const selectedIndustry = industries.find((i) => i.slug === industrySlug) ?? null;

  function handleContinue() {
    if (facilityTypeSlug) {
      router.push(`/compare/${facilityTypeSlug}`);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle>1. Выберите отрасль</CardTitle>
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
            <CardTitle>2. Выберите тип объекта</CardTitle>
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

      <Button onClick={handleContinue} disabled={!facilityTypeSlug}>
        Перейти к сравнению решений
      </Button>
    </div>
  );
}
