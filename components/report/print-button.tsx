"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="no-print">
      Печать / Сохранить PDF
    </Button>
  );
}
