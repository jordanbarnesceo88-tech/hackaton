"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CreateProjectState } from "@/lib/projects/actions";
import { submitCalculation } from "@/lib/calculation-jobs/client";
import type { CalculationRequest } from "@/lib/calculation-jobs/service";
import { stableJson } from "@/lib/tz/version";
import type { ParamValues } from "@/lib/tz/types";
import { cn } from "@/lib/utils";
import { ImportForm } from "./import-form";

/**
 * Форма «Новый проект» (ТЗ §2.2 шаг 1 — выбор объекта, шаг 2 — параметры вручную или из
 * Excel/CSV; §3.1.3 — создание проекта; §5.4 — путь жюри «создать проект»).
 *
 * Сервер проверяет ввод и принимает долговременный расчёт. Отдельная страница показывает
 * выполнение и открывает проект после атомарного сохранения результата.
 *
 * Поля управляемые: после ответа с ошибкой React сбрасывает неуправляемые поля формы, и
 * введённое название пропало бы вместе с выбранным файлом.
 */

export type FacilityOption = { slug: string; label: string; note: string };

/** Три базовых типа объекта (ТЗ §5.5) с пояснением, что для каждого реализовано. */
export const FACILITY_OPTIONS: readonly FacilityOption[] = [
  { slug: "warehouse", label: "Склад", note: "Подбор, экономика, сценарии и имитация парка" },
  { slug: "airport", label: "Аэропорт", note: "Параметры и подбор решений; экономика — прототип" },
  { slug: "medical", label: "Медучреждение", note: "Параметры и подбор решений; экономика — прототип" },
];

type Source = "demo" | "upload" | "manual";

const SOURCE_OPTIONS: readonly { value: Source; label: string; note: string }[] = [
  {
    value: "demo",
    label: "Демо-данные объекта",
    note: "Базовые значения демо-набора данных для выбранного типа объекта.",
  },
  {
    value: "upload",
    label: "Загрузить Excel/CSV по шаблону",
    note: "Файл проверяется на сервере: полнота, формат, единицы и диапазоны. Сам файл не сохраняется.",
  },
  {
    value: "manual",
    label: "Заполнить вручную (от базовых значений)",
    note: "Проект создаётся на базовых значениях — поправьте их в шаге 2 рабочей области.",
  },
];

const INITIAL: CreateProjectState = { error: null };

/** Применённый файл параметров: значения, имя файла и тип объекта, для которого он проверен. */
type Applied = { values: ParamValues; fileName: string; facility: string };

const INPUT = "field field--lg";

/** A receipt belongs to this exact form submission, never a later edited CREATE. */
export function acceptedCreateJobId(request: CalculationRequest, previous: { inputKey: string; id: string } | null): string | null {
  return previous?.inputKey === stableJson(request) ? previous.id : null;
}

export function NewProjectForm({ defaultFacility = "warehouse" }: { defaultFacility?: string }) {
  const router = useRouter();
  const mounted = useRef(true);
  const accepted = useRef<{ inputKey: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const nameId = useId();
  const objectId = useId();
  const facilityLabelId = useId();
  const sourceLabelId = useId();
  const [state, formAction, pending] = useActionState(
    async (_prev: CreateProjectState, formData: FormData): Promise<CreateProjectState> => {
      try {
        const selectedSource = String(formData.get("source") ?? "demo");
        const paramsJson = String(formData.get("paramsJson") ?? "");
        if (selectedSource === "upload" && !paramsJson) return { error: "Сначала проверьте файл и примените значения" };
        const request: CalculationRequest = { operation: "CREATE", name: String(formData.get("name") ?? ""),
          objectName: String(formData.get("objectName") ?? ""), facility: String(formData.get("facility") ?? "warehouse"),
          ...(selectedSource === "upload" ? { params: JSON.parse(paramsJson) } : {}),
          paramsSource: { kind: selectedSource === "upload" ? "upload" : selectedSource === "manual" ? "manual" : "demo",
            ...(selectedSource === "upload" ? { fileName: String(formData.get("fileName") ?? "") } : {}) },
        };
        const previousId = acceptedCreateJobId(request, accepted.current);
        if (previousId) {
          if (mounted.current) router.push(`/calculation-jobs/${encodeURIComponent(previousId)}?open=1`);
          return { error: null };
        }
        const job = await submitCalculation(request, "create-project");
        accepted.current = { inputKey: stableJson(request), id: job.id };
        // Keep the retry key until the acknowledged job page is actually opened.
        if (mounted.current) router.push(`/calculation-jobs/${encodeURIComponent(job.id)}?open=1`);
        return { error: null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Не удалось отправить расчёт. Повторите с теми же данными" };
      }
    },
    INITIAL,
  );
  const [name, setName] = useState("");
  const [objectName, setObjectName] = useState("");
  const [facility, setFacility] = useState(
    FACILITY_OPTIONS.some((f) => f.slug === defaultFacility) ? defaultFacility : "warehouse",
  );
  const [source, setSource] = useState<Source>("demo");
  const [applied, setApplied] = useState<Applied | null>(null);

  // Файл проверялся для другого типа объекта — его значения к этому типу не относятся.
  const upload = source === "upload" && applied !== null && applied.facility === facility ? applied : null;
  const uploadMissing = source === "upload" && upload === null;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            Название проекта
          </label>
          <input
            id={nameId}
            name="name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Например, РЦ Подольск"
            maxLength={120}
            required
            autoComplete="off"
            className={INPUT}
          />
          <p className="text-xs text-muted-foreground">От 1 до 120 символов, например «РЦ Подольск».</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={objectId} className="text-sm font-medium">
            Объект (необязательно)
          </label>
          <input
            id={objectId}
            name="objectName"
            value={objectName}
            onChange={(e) => setObjectName(e.currentTarget.value)}
            placeholder="Например, склад класса A, Подольск, ул. Складская, 1"
            maxLength={200}
            autoComplete="off"
            className={INPUT}
          />
          <p className="text-xs text-muted-foreground">Адрес или название объекта — для отчёта.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p id={facilityLabelId} className="text-sm font-medium">
          Тип объекта
        </p>
        <div role="radiogroup" aria-labelledby={facilityLabelId} className="grid gap-3 sm:grid-cols-3">
          {FACILITY_OPTIONS.map((f) => {
            const checked = facility === f.slug;
            return (
              <label
                key={f.slug}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-lg border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                  checked ? "border-primary bg-primary/5" : "hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="facility"
                    value={f.slug}
                    checked={checked}
                    onChange={() => setFacility(f.slug)}
                    className="size-4 accent-primary"
                  />
                  <span className="font-medium">{f.label}</span>
                </span>
                <span className="text-xs text-muted-foreground">{f.note}</span>
              </label>
            );
          })}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend id={sourceLabelId} className="mb-2 text-sm font-medium">
          Источник параметров объекта
        </legend>
        <div className="flex flex-col gap-2">
          {SOURCE_OPTIONS.map((s) => (
            <label key={s.value} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="source"
                value={s.value}
                checked={source === s.value}
                onChange={() => setSource(s.value)}
                className="mt-1 size-4 accent-primary"
              />
              <span className="flex flex-col">
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.note}</span>
              </span>
            </label>
          ))}
        </div>
        {source === "upload" && (
          <div className="mt-2 rounded-lg border px-4 py-3">
            <ImportForm
              facility={facility}
              compact
              onApply={(values, meta) => setApplied({ values, fileName: meta.fileName, facility })}
            />
            <p className={cn("mt-2 text-sm", upload ? "text-positive" : "text-muted-foreground")}>
              {upload
                ? `Параметры из файла «${upload.fileName}» будут использованы в проекте`
                : "Проверьте файл, нажмите «Применить значения» и создайте проект."}
            </p>
          </div>
        )}
        <input type="hidden" name="paramsJson" value={upload ? JSON.stringify(upload.values) : ""} />
        <input type="hidden" name="fileName" value={upload ? upload.fileName : ""} />
      </fieldset>

      <div className="flex flex-col gap-2">
        <p role="alert" aria-live="assertive" className="text-sm text-destructive [&:empty]:hidden">
          {state.error ?? ""}
        </p>
        {state.issues && state.issues.some((i) => i.severity === "error") && (
          <ul className="grid gap-0.5 pl-5 text-sm text-destructive">
            {state.issues
              .filter((i) => i.severity === "error")
              .map((i, n) => (
                <li key={`${i.key}-${n}`} className="list-disc">
                  {i.row !== undefined ? `Строка ${i.row}: ` : ""}
                  {i.message}
                </li>
              ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={pending || uploadMissing}>
            {pending ? "Отправляем расчёт…" : "Создать проект"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {pending
              ? "Проверяем параметры и сохраняем задание на сервере."
              : "После отправки откроется ход расчёта. Затем — рабочая область проекта с подбором, экономикой, сценариями и имитацией."}
          </p>
        </div>
      </div>
    </form>
  );
}
