"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded-md border px-3 py-2 text-sm font-medium"
    >
      Печать / Сохранить PDF
    </button>
  );
}
