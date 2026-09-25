import Link from "next/link";
import type { ReactNode } from "react";
import { NEEDS_VERIFICATION_LABEL, scenarioItemKey, scenarioItemKeys, statusChipLabel } from "@/components/project/comparison-table";
import { LineItems } from "@/components/project/line-items";
import { ScenarioTable } from "@/components/project/scenario-table";
import { scoreTotalText } from "@/components/project/score-bar";
import { SensitivityPanel } from "@/components/project/sensitivity-panel";
import { safeHttpUrl } from "@/components/project/source-badge";
import { PrintButton } from "@/components/report/print-button";
import { pluralRu } from "@/lib/format/plural";
import { formatNum, formatRub } from "@/lib/format/rub";
import type { ParamsSource } from "@/lib/projects/queries";
import {
  MANUAL_NOTE,
  changeRows,
  cashflowRows,
  facilityLabelOf,
  formatCalcDate,
  paramsRows,
  processLabel,
  scenarioFinance,
  scenarioTitle,
  simCellText,
  sourcesRows,
  yearsCount,
  type ReportChange,
} from "@/lib/report/tz/rows";
import {
  formulaRows,
  modelLimitations,
  normOverrideRows,
  normsReportRows,
  riskRows,
  simTable,
  type NormReportRow,
} from "@/lib/report/tz/tables";
import { SIM_MODEL_VERSION } from "@/lib/sim/types";
import { DISCLAIMER } from "@/lib/tz/econ";
import { fx } from "@/lib/tz/econ/text";
import { DEFAULT_NORMS } from "@/lib/tz/norms";
import { rangeText } from "@/lib/tz/params/messages";
import type { ParamSpec, ProjectResults, ScenarioOk, ScenarioResult, SelectionResult } from "@/lib/tz/types";
import { TZ_MODEL_VERSION } from "@/lib/tz/version";
import { cn } from "@/lib/utils";
import { LayoutLegend, WarehouseLayoutSvg, reportLayout } from "./layout-svg";
import {
  REPORT_TOP_LEVERS,
  displayUrl,
  fleetLines,
  fleetSoftwareText,
  groupInOrder,
  layoutGroups,
  missingText,
  normValueText,
  paramNotes,
  paramsSourceText,
  scenarioSelectionLimitations,
  scenarioTitleMap,
  scoreFactorsText,
  selectionByProcess,
  topLevers,
} from "./report-model";

/**
 * Печатный отчёт по проекту модели tz-1.0.0 (ТЗ §2.2 шаг 8, §3.7.2): параметры объекта,
 * подобранные решения, состав оборудования, экономика сценариев, статьи CAPEX и OPEX, денежный
 * поток, чувствительность, имитация со схемой, вывод и риски, формулы, нормативы, ограничения,
 * источники данных и журнал корректировок; дата расчёта и версии модели и данных (§3.1.5);
 * оговорка «предварительная оценка» (§3.7.4). PDF — печатью браузера («Печать / Сохранить PDF»).
 *
 * Серверный компонент: всё берётся из сохранённого расчёта (`ProjectResults`), ничего не
 * пересчитывается, поэтому отчёт совпадает с выгрузками XLSX и CSV и воспроизводится при
 * повторном открытии. Длинные таблицы не оборачиваются в `.report-block` (запрет разрыва
 * внутри блока выше страницы оставил бы пустые листы) и помечены `print-table`: заголовок
 * повторяется на каждой странице, строка не рвётся (app/globals.css).
 */

export type ProjectReportProps = {
  project: {
    id: string;
    name: string;
    objectName: string | null;
    facility: string;
    paramsSource: ParamsSource;
  };
  results: ProjectResults;
  /** Описания параметров объекта (подписи, единицы, диапазоны, источники значений по умолчанию). */
  defs: readonly ParamSpec[];
  /** Журнал корректировок в порядке записи. */
  changes: readonly ReportChange[];
  /**
   * Версия данных, которую получил бы проект на живых данных (lib/projects/recalc,
   * liveDataVersionFrom); не совпадает с `results.dataVersion` — каталог, нормативы или
   * описания параметров изменились после расчёта, и отчёт говорит об этом (§3.1.5).
   * null — не проверялась.
   */
  liveDataVersion?: string | null;
};

const TH = "px-2 py-1.5 text-left align-bottom font-medium text-muted-foreground";
const TD = "border-t px-2 py-1 align-top";
const TABLE = "print-table w-full border-collapse text-sm";
const TABLE_WRAP = "data-table-wrap";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="report-section mt-8 flex flex-col gap-3">
      <h2 id={`${id}-title`} className="border-b pb-1 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Результаты для таблицы сценариев без трассировки и чувствительности: таблица их не читает, а в данные клиентского компонента они попали бы целиком. */
function tableResults(results: readonly ScenarioResult[]): ScenarioResult[] {
  return results.map((r) => (r.status === "ok" ? { ...r, trace: [], sensitivity: [] } : { ...r, trace: [] }));
}

// ——————————————————————————— Шапка ———————————————————————————

function ReportHeader({ project, results, liveDataVersion }: Pick<ProjectReportProps, "project" | "results" | "liveDataVersion">) {
  const stale = results.modelVersion !== TZ_MODEL_VERSION || results.simModelVersion !== SIM_MODEL_VERSION;
  const dataStale = typeof liveDataVersion === "string" && liveDataVersion !== results.dataVersion;
  return (
    <>
      <header className="report-block border-b-2 border-primary pb-3">
        <div className="text-xs font-medium uppercase tracking-wide text-primary">
          Предварительная оценка роботизации · модель по методике ТЗ
        </div>
        {/* Размеры заданы явно, а не экранной шкалой: отчёт печатается на A4. */}
        <h1 className="text-2xl font-semibold">Отчёт по проекту: {project.name}</h1>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          Дата расчёта: {formatCalcDate(results.calculatedAt)} · модель {results.modelVersion} · имитация{" "}
          {results.simModelVersion} · данные {results.dataVersion}
        </p>
        <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr]">
          {project.objectName && (
            <>
              <dt className="text-muted-foreground">Объект</dt>
              <dd>{project.objectName}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Тип объекта</dt>
          <dd>{facilityLabelOf(results.facility)}</dd>
          <dt className="text-muted-foreground">Параметры объекта</dt>
          <dd>{paramsSourceText(project.paramsSource, results.facility)}</dd>
        </dl>
      </header>
      <p role="note" className="report-block mt-4 rounded-md border border-caution/50 bg-caution/10 px-3 py-2 text-sm font-medium">
        {DISCLAIMER}
      </p>
      {stale && (
        <p role="note" className="report-block mt-3 rounded-md border border-destructive/40 px-3 py-2 text-sm">
          Расчёт выполнен моделью {results.modelVersion} (имитация {results.simModelVersion}), а в этой версии платформы —{" "}
          {TZ_MODEL_VERSION} (имитация {SIM_MODEL_VERSION}). Отчёт показывает сохранённый расчёт; чтобы получить числа
          текущей модели, откройте проект и пересчитайте его на актуальных данных.
        </p>
      )}
      {dataStale && (
        <p role="note" className="report-block mt-3 rounded-md border border-destructive/40 px-3 py-2 text-sm">
          Данные каталога, нормативов или описаний параметров изменились после расчёта (версия данных в расчёте —{" "}
          {results.dataVersion}, сейчас — {liveDataVersion}). Числа отчёта — из сохранённого снимка расчёта, а значения по
          умолчанию, диапазоны, отметки ⚠ и «Задано вами» в разделе «Параметры объекта» — по текущим описаниям параметров
          и могут с ним расходиться. Чтобы отчёт целиком соответствовал текущим данным, откройте проект и пересчитайте его на
          актуальных данных.
        </p>
      )}
      <div className="report-block mt-4 rounded-md border px-3 py-2">
        <div className="text-xs font-medium text-muted-foreground">Краткий вывод</div>
        <p className="mt-0.5 text-sm font-semibold">{results.conclusion.headline}</p>
      </div>
    </>
  );
}

function Toolbar({ projectId }: { projectId: string }) {
  const btn = "rounded-md border px-3 py-2 text-sm font-medium";
  return (
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
      <Link href={`/projects/${projectId}`} className="text-sm text-primary underline-offset-2 hover:underline">
        ← К проекту
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <PrintButton />
        {/* Обычные ссылки, не next/link: это скачивание файла, а не переход по приложению. */}
        <a href={`/projects/${projectId}/export.xlsx`} download className={btn}>
          Скачать Excel
        </a>
        <a href={`/projects/${projectId}/export.csv`} download className={btn}>
          Скачать CSV
        </a>
      </div>
    </div>
  );
}

// ——————————————————————————— Параметры объекта ———————————————————————————

function ParamsSection({ results, defs }: { results: ProjectResults; defs: readonly ParamSpec[] }) {
  const rows = paramsRows(results, defs);
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const view = rows.map((row) => {
    const def = defByKey.get(row.key);
    const notes = def ? paramNotes(def, row.value, results.paramIssues, rangeText(def)) : row.notes;
    return { row, notes };
  });
  // Каждый раздел — один раз, в порядке первого появления (как в форме параметров проекта).
  const sections = groupInOrder(view, (v) => v.row.section);
  const changed = rows.filter((r) => r.changed).length;
  const outOfRange = rows.filter((r) => r.outOfRange).length;
  return (
    <Section id="params" title="Параметры объекта">
      <Note>
        Значения, с которыми выполнен расчёт. Параметров: {rows.length} · задано вами: {changed} · вне допустимого диапазона:{" "}
        {outOfRange}. Источник — откуда взято значение по умолчанию; значение, заданное вами, так и подписано.
      </Note>
      <div className={TABLE_WRAP}>
        <table className={TABLE}>
          <thead className="border-b">
            <tr>
              <th scope="col" className={TH}>Параметр</th>
              <th scope="col" className={`${TH} text-right`}>Значение</th>
              <th scope="col" className={TH}>Ед.</th>
              <th scope="col" className={`${TH} text-right`}>По умолчанию</th>
              <th scope="col" className={TH}>Диапазон</th>
              <th scope="col" className={TH}>Источник</th>
              <th scope="col" className={TH}>Замечания</th>
            </tr>
          </thead>
          {sections.map((s) => (
            <tbody key={s.name}>
              <tr>
                <th scope="colgroup" colSpan={7} className="border-t bg-muted/20 px-2 py-1 text-left text-xs font-semibold">
                  {s.name}
                </th>
              </tr>
              {s.items.map(({ row, notes }) => (
                <tr key={row.key} className={cn(row.outOfRange && "bg-caution/10")}>
                  <th scope="row" className={`${TD} text-left font-normal`}>{row.label}</th>
                  <td className={cn(TD, "text-right tabular-nums", row.changed && "font-semibold")}>
                    {row.outOfRange && <span className="mr-1 text-caution">⚠</span>}
                    {row.cells[2]}
                  </td>
                  <td className={TD}>{row.unit}</td>
                  <td className={`${TD} text-right tabular-nums text-muted-foreground`}>{row.cells[4]}</td>
                  <td className={`${TD} tabular-nums`}>{row.cells[5]}</td>
                  <td className={`${TD} text-xs break-words`}>{row.source}</td>
                  <td className={`${TD} text-xs`}>{notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Section>
  );
}

// ——————————————————————————— Подбор ———————————————————————————

/** Статус подбора для ячейки: подпись, «требует проверки», «в сценариях». */
function StatusCell({ s, inScenario }: { s: SelectionResult; inScenario: boolean }) {
  return (
    <td className={`${TD} text-xs`}>
      <div className="font-medium">{statusChipLabel(s.status)}</div>
      {s.needsVerification && <div className="text-caution">{NEEDS_VERIFICATION_LABEL}</div>}
      {inScenario && <div className="text-muted-foreground">в сценариях</div>}
    </td>
  );
}

function ProductCell({ s, manual, process = false }: { s: SelectionResult; manual: boolean; process?: boolean }) {
  return (
    <th scope="row" className={`${TD} text-left font-normal`}>
      {s.productName}
      {manual && (
        <span className="ml-1 text-caution" title="Добавлено вручную">
          ⚠
        </span>
      )}
      {process && <div className="text-xs text-muted-foreground">{processLabel(s.process)}</div>}
    </th>
  );
}

function SelectionSection({ results }: { results: ProjectResults }) {
  const inScenarios = scenarioItemKeys(results.scenarios);
  const groups = selectionByProcess(results.selection);
  const manualKeys = new Set<string>();
  for (const s of results.scenarios) {
    for (const it of s.items) if (it.manuallyAdded) manualKeys.add(scenarioItemKey(it.process, it.productSlug));
  }
  const chosen = results.selection.filter((s) => inScenarios.has(scenarioItemKey(s.process, s.productSlug)));
  return (
    <Section id="selection" title="Подобранные решения">
      <Note>
        Подбор по процессам объекта (ТЗ §3.4): статус, причины включения или исключения, ограничения и недостающие данные;
        балл 0–100 раскладывается на вклады факторов (очки / вес).
      </Note>
      <h3 className="text-base font-semibold">Решения в сценариях</h3>
      {chosen.length === 0 ? (
        <p className="text-sm text-muted-foreground">В сценариях нет решений из подбора.</p>
      ) : (
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead className="border-b">
              <tr>
                <th scope="col" className={TH}>Решение</th>
                <th scope="col" className={TH}>Статус</th>
                <th scope="col" className={TH}>Балл</th>
                <th scope="col" className={TH}>Причины</th>
                <th scope="col" className={TH}>Ограничения</th>
                <th scope="col" className={TH}>Недостающие данные</th>
              </tr>
            </thead>
            <tbody>
              {chosen.map((s) => {
                const key = scenarioItemKey(s.process, s.productSlug);
                return (
                  <tr key={key}>
                    <ProductCell s={s} manual={manualKeys.has(key)} process />
                    <StatusCell s={s} inScenario />
                    <td className={`${TD} text-xs`}>
                      <div className="font-medium whitespace-nowrap tabular-nums">{scoreTotalText(s.score)}</div>
                      {s.score.total !== null && s.score.contributions.length > 0 && (
                        <div className="text-muted-foreground">{scoreFactorsText(s.score.contributions)}</div>
                      )}
                    </td>
                    <td className={`${TD} text-xs`}>{s.reasons.join("; ") || "—"}</td>
                    <td className={`${TD} text-xs`}>{s.limitations.join("; ") || "—"}</td>
                    <td className={`${TD} text-xs`}>{missingText(s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="mt-2 text-base font-semibold">Все результаты подбора по процессам</h3>
      <Note>
        По каждому решению — статус, балл, причины включения или исключения, ограничения и недостающие данные (что уточнить
        и как). Решения, которые стоят в сценариях, описаны в таблице выше.
      </Note>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">Подбор не выполнялся: у объекта нет процессов с решениями в каталоге.</p>
      )}
      {groups.map((g) => (
        <div key={g.process} className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold">{processLabel(g.process)}</h4>
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead className="border-b">
                <tr>
                  <th scope="col" className={TH}>Решение</th>
                  <th scope="col" className={TH}>Статус</th>
                  <th scope="col" className={TH}>Балл</th>
                  <th scope="col" className={TH}>Причины</th>
                  <th scope="col" className={TH}>Ограничения</th>
                  <th scope="col" className={TH}>Недостающие данные</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((s) => {
                  const key = scenarioItemKey(s.process, s.productSlug);
                  const inScenario = inScenarios.has(key);
                  return (
                    <tr key={key}>
                      <ProductCell s={s} manual={manualKeys.has(key)} />
                      <StatusCell s={s} inScenario={inScenario} />
                      <td className={`${TD} text-xs whitespace-nowrap tabular-nums`}>{scoreTotalText(s.score)}</td>
                      {inScenario ? (
                        <td className={`${TD} text-xs text-muted-foreground`} colSpan={3}>
                          Причины, ограничения, недостающие данные и вклады факторов балла — в таблице «Решения в сценариях»
                          выше.
                        </td>
                      ) : (
                        <>
                          <td className={`${TD} text-xs`}>{s.reasons.join("; ") || "—"}</td>
                          <td className={`${TD} text-xs`}>{s.limitations.join("; ") || "—"}</td>
                          <td className={`${TD} text-xs`}>{missingText(s)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </Section>
  );
}

// ——————————————————————————— Состав оборудования ———————————————————————————

function EquipmentSection({ results }: { results: ProjectResults }) {
  return (
    <Section id="equipment" title="Состав оборудования">
      <Note>
        Роботы и вспомогательное оборудование по сценариям. Число роботов = пиковый поток / (производительность × загрузка ×
        доступность) × (1 + резерв), с округлением вверх; производительность — меньшая из паспортной нормы и расчёта по циклу
        на планировке объекта.
      </Note>
      <div className={TABLE_WRAP}>
        <table className={TABLE}>
          <thead className="border-b">
            <tr>
              <th scope="col" className={TH}>Сценарий и решение</th>
              <th scope="col" className={`${TH} text-right`}>Роботов</th>
              <th scope="col" className={`${TH} text-right`}>Зарядных станций</th>
              <th scope="col" className={`${TH} text-right`}>Постов диспетчера</th>
              <th scope="col" className={TH}>ПО управления парком</th>
              <th scope="col" className={TH}>Как получено</th>
            </tr>
          </thead>
          <tbody>
            {results.results.map((r) => {
              const title = scenarioTitle(results, r);
              if (r.kind === "asis") {
                return (
                  <tr key={r.key}>
                    <th scope="row" className={`${TD} text-left font-medium`}>{title}</th>
                    <td className={`${TD} text-muted-foreground`} colSpan={5}>
                      Текущий процесс, без роботов
                    </td>
                  </tr>
                );
              }
              if (r.items.length === 0) {
                return (
                  <tr key={r.key}>
                    <th scope="row" className={`${TD} text-left font-medium`}>{title}</th>
                    <td className={`${TD} text-muted-foreground`} colSpan={5}>
                      {r.status === "refused" ? `Не рассчитан: ${r.refusal.message}` : "Решение не выбрано"}
                    </td>
                  </tr>
                );
              }
              const software = fleetSoftwareText(r);
              return r.items.map((it, i) => (
                <tr key={`${r.key}-${it.process}`}>
                  <th scope="row" className={`${TD} text-left font-normal`}>
                    {i === 0 && <div className="font-medium">{title}</div>}
                    <div className="text-xs text-muted-foreground">
                      {processLabel(it.process)}: {it.productName}
                      {it.manuallyAdded && <span className="ml-1 text-caution">⚠</span>}
                    </div>
                    {i === 0 && r.status === "refused" && (
                      <div className="mt-1 text-xs text-destructive">Не рассчитан: {r.refusal.message}</div>
                    )}
                  </th>
                  <td className={`${TD} text-right tabular-nums`}>
                    {it.n === null ? "—" : formatNum(it.n)}
                    {it.nOverridden && <div className="text-xs text-caution">задано вручную</div>}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{formatNum(it.chargers)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatNum(it.operatorPosts)}</td>
                  <td className={`${TD} text-xs`}>{i === 0 ? software : ""}</td>
                  <td className={`${TD} text-xs`}>
                    <ul className="flex flex-col gap-0.5">
                      {fleetLines(it).map((l, li) => (
                        <li key={li}>{l}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ——————————————————————————— Экономика сценариев ———————————————————————————

function EconomicsSection({ results, defs }: { results: ProjectResults; defs: readonly ParamSpec[] }) {
  const ok = results.results.filter((r): r is ScenarioOk => r.status === "ok");
  const norms = { ...DEFAULT_NORMS, ...results.normsUsed };
  const tcoYears = ok[0]?.tcoYears ?? norms.tcoMinYears;
  const paramLabels = Object.fromEntries(defs.map((d) => [d.key, d.label]));
  const manual = results.results.some((r) => r.items.some((it) => it.manuallyAdded));
  return (
    <Section id="economics" title="Экономика сценариев">
      <Note>
        Текущий процесс и варианты роботизации в одной таблице. ★ — рекомендуемый сценарий: наибольший NPV среди окупаемых
        (NPV ≥ 0 и дисконтированная окупаемость в пределах горизонта); интерпретация окупаемости — описание, а не критерий.
      </Note>
      <ScenarioTable
        results={tableResults(results.results)}
        sim={results.sim}
        tcoYears={tcoYears}
        recommendedKey={results.conclusion.recommendedScenarioKey}
        norms={norms}
        paramLabels={paramLabels}
        print
        readOnly
      />
      {manual && <Note>{MANUAL_NOTE}</Note>}
    </Section>
  );
}

// ——————————————————————————— CAPEX и OPEX ———————————————————————————

function LinesSection({ results }: { results: ProjectResults }) {
  return (
    <Section id="lines" title="CAPEX и OPEX по статьям">
      <Note>
        Каждая статья — с формулой, подстановкой чисел и происхождением значения (организатор, открытый источник, оценка с
        обоснованием, норматив). Статья услуги (RaaS), принятая входящей в подписку, показана с нулём и пометкой — это
        допущение, которое проверяется по договору.
      </Note>
      {results.results.map((r) => (
        <div key={r.key} className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">{scenarioTitle(results, r)}</h3>
          {r.status !== "ok" ? (
            <p className="text-sm text-destructive">Не рассчитан: {r.refusal.message}</p>
          ) : (
            <>
              {r.kind !== "asis" && (
                <LineItems title="CAPEX по статьям" lines={r.capexLines} total={r.capexRub} totalLabel="CAPEX, итого" print />
              )}
              <LineItems title="OPEX за год по статьям" lines={r.opexLines} total={r.opexYearRub} totalLabel="OPEX за год, итого" print />
            </>
          )}
        </div>
      ))}
    </Section>
  );
}

// ——————————————————————————— Денежный поток ———————————————————————————

const CASHFLOW_COLUMNS = [
  { key: "capexRub", label: "CAPEX" },
  { key: "opexRub", label: "OPEX" },
  { key: "batteryRub", label: "в т. ч. замена АКБ" },
  { key: "reinvestRub", label: "Докупка" },
  { key: "effectRub", label: "Эффект" },
  { key: "cashflowRub", label: "Поток" },
  { key: "cumulativeRub", label: "Накопленный" },
  { key: "cumulativeDiscountedRub", label: "Накопленный дисконтированный" },
] as const;

function CashflowSection({ results }: { results: ProjectResults }) {
  const robots = results.results.filter((r): r is ScenarioOk => r.status === "ok" && r.kind !== "asis");
  const asis = results.results.find((r): r is ScenarioOk => r.status === "ok" && r.kind === "asis");
  return (
    <Section id="cashflow" title="Денежный поток">
      <Note>
        Год 0 — вложения (CAPEX). Эффект года = OPEX «Как есть» − OPEX сценария с фактической заменой АКБ в этом году;
        докупка оборудования — по сроку службы. NPV, ROI и дисконтированная окупаемость считаются за горизонт расчёта, TCO — за
        горизонт TCO (не меньше 5 лет); годы после горизонта расчёта отмечены *. Суммы в рублях.
      </Note>
      {asis && (
        <p className="text-sm">
          «{scenarioTitle(results, asis)}»: затраты постоянны — OPEX {formatRub(asis.opexYearRub)} в год, TCO за{" "}
          {yearsCount(asis.tcoYears)} {formatRub(asis.tcoRub)}.
        </p>
      )}
      {robots.length === 0 && <p className="text-sm text-muted-foreground">Нет рассчитанных сценариев роботизации.</p>}
      {robots.map((r) => {
        const f = scenarioFinance(results, r);
        const rows = cashflowRows(r);
        return (
          <div key={r.key} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold">{scenarioTitle(results, r)}</h3>
            <p className="text-xs text-muted-foreground">
              Ставка дисконтирования {fx(f.rate * 100, 1)} % · горизонт расчёта {f.H === null ? "—" : yearsCount(f.H)} · горизонт
              TCO {yearsCount(f.T)} · NPV {formatRub(r.npvRub)} · TCO {formatRub(r.tcoRub)}
            </p>
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <thead className="border-b">
                  <tr>
                    <th scope="col" className={TH}>Год</th>
                    {CASHFLOW_COLUMNS.map((c) => (
                      <th key={c.key} scope="col" className={`${TH} text-right`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const tail = f.H !== null && c.year > f.H;
                    return (
                      <tr key={c.year} className={cn(tail && "text-muted-foreground")}>
                        <th scope="row" className={`${TD} text-left font-normal tabular-nums`}>
                          {c.year}
                          {tail ? "*" : ""}
                        </th>
                        {CASHFLOW_COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className={cn(TD, "text-right tabular-nums whitespace-nowrap", c[col.key] < 0 && !tail && "text-destructive")}
                          >
                            {formatRub(c[col.key])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </Section>
  );
}

// ——————————————————————————— Чувствительность ———————————————————————————

function SensitivitySection({ results }: { results: ProjectResults }) {
  const groups = results.results.filter((r): r is ScenarioOk => r.status === "ok" && r.sensitivity.length > 0);
  return (
    <Section id="sensitivity" title="Чувствительность">
      <Note>
        По каждому сценарию — {REPORT_TOP_LEVERS} сильнейших рычагов из рассчитанных; полный перечень — в выгрузке Excel, лист
        «Чувствительность». Для вариантов роботизации результат — NPV, для «Как есть» — TCO. Границы — из диапазона
        организатора, норматива или ±20 %.
      </Note>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">Чувствительность не рассчитана: нет рассчитанных сценариев.</p>}
      {groups.map((r) => {
        const all = r.sensitivity.length;
        const rows = topLevers(r.sensitivity);
        return (
          <div key={r.key} className="flex flex-col gap-1">
            <SensitivityPanel
              scenarioName={scenarioTitle(results, r)}
              rows={rows}
              metric={r.kind === "asis" ? "tco" : "npv"}
              baseValue={r.kind === "asis" ? r.tcoRub : r.npvRub}
              print
            />
            {all > rows.length && (
              <Note>
                Показано {rows.length} из {all} рычагов.
              </Note>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ——————————————————————————— Имитация ———————————————————————————

function simValueText(v: number | string): string {
  return typeof v === "number" ? fx(v) : v;
}

function SimSection({ results }: { results: ProjectResults }) {
  const table = simTable(results);
  const norms = { ...DEFAULT_NORMS, ...results.normsUsed };
  const groups = layoutGroups(results);
  return (
    <Section id="simulation" title="Имитация">
      <Note>
        Имитация проверяет, выдерживает ли парк из расчёта пиковый поток на той же планировке, по которой посчитано плечо
        перевозки: {fx(norms.simWarmupMin)} мин прогрева и {fx(norms.simPeakMin)} мин пика. Расчёт подтверждён, если за пик
        обслужено не меньше {fx(norms.simServedShareMin * 100, 1)} % заданий, а 95 % заданий ждут не дольше{" "}
        {fx(norms.simP95WaitMaxMin)} мин; простой от {fx(norms.simOversizedIdleShare * 100, 1)} % — парк избыточен. Прогон
        детерминирован (зерно генератора в таблице): повторный прогон даёт те же числа.
      </Note>
      {table.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">Имитация не выполнялась: нет сценариев роботизации с перевозкой паллет.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5 text-sm">
            {table.columns.map((c) => {
              const s = results.sim[c.scenarioKey] ?? null;
              return (
                <li key={c.scenarioKey}>
                  <span className="font-medium">{c.title}:</span> {simCellText(s)}
                  {s ? ` — рассчитано ${fx(s.requiredPerH, 1)}, достигнуто ${fx(s.achievedPerH, 1)} пал./ч при ${formatNum(s.fleet)} роботах` : ""}
                </li>
              );
            })}
          </ul>
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead className="border-b">
                <tr>
                  <th scope="col" className={TH}>Показатель</th>
                  {table.columns.map((c) => (
                    <th key={c.scenarioKey} scope="col" className={`${TH} text-right`}>
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.labels.map((label, i) => (
                  <tr key={label}>
                    <th scope="row" className={`${TD} text-left font-normal`}>{label}</th>
                    {(table.values[i] ?? []).map((v, j) => (
                      <td key={j} className={`${TD} text-right tabular-nums`}>
                        {simValueText(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {table.notChecked.length > 0 && <Note>Имитацией не проверялись: {table.notChecked.join(", ")}.</Note>}
      {groups.map((g) => {
        const layout = reportLayout(results.paramsUsed, g.chargers);
        if (!layout) {
          return (
            <Note key={g.chargers}>
              Схема для «{g.titles.join("», «")}» не построена: в параметрах объекта не хватает площади активной зоны, ширины
              проходов или числа ворот.
            </Note>
          );
        }
        const chargers = `${formatNum(g.chargers)} ${pluralRu(g.chargers, ["зарядная станция", "зарядные станции", "зарядных станций"])}`;
        return (
          <figure key={g.chargers} className="report-block flex flex-col gap-2 rounded-md border p-3">
            <figcaption className="text-sm font-medium">
              Схема склада: {g.titles.join(", ")} ({chargers})
            </figcaption>
            <div className="mx-auto w-full max-w-3xl">
              <WarehouseLayoutSvg
                layout={layout}
                label={`Схема склада ${fx(layout.widthM, 0)} × ${fx(layout.heightM, 0)} м: зоны приёмки, хранения, отгрузки и зарядки, проезды, ворота и зарядные станции`}
              />
            </div>
            <LayoutLegend />
            <Note>
              Типовая планировка по параметрам объекта: около {fx(layout.widthM, 0)} × {fx(layout.heightM, 0)} м, стеллажных
              проходов — {formatNum(layout.rackAislesX.length)}, ворот приёмки — {formatNum(layout.receiving.length)}, отгрузки —{" "}
              {formatNum(layout.shipping.length)}. По этой же схеме посчитано среднее плечо перевозки
              {g.item.routeLoadedM !== null && g.item.routeEmptyM !== null
                ? `: с грузом ${fx(g.item.routeLoadedM, 1)} м, порожнее ${fx(g.item.routeEmptyM, 1)} м`
                : ""}
              . Это оценка по планировке, а не по чертежу объекта.
            </Note>
          </figure>
        );
      })}
    </Section>
  );
}

// ——————————————————————————— Вывод и риски ———————————————————————————

function ConclusionSection({ results }: { results: ProjectResults }) {
  const risks = riskRows(results);
  return (
    <Section id="conclusion" title="Вывод и риски">
      <p className="text-sm font-semibold">{results.conclusion.headline}</p>
      {results.conclusion.bullets.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {results.conclusion.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      <h3 className="mt-2 text-base font-semibold">Риски по сценариям</h3>
      {risks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Рисков не выявлено.</p>
      ) : (
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead className="border-b">
              <tr>
                <th scope="col" className={TH}>Сценарий</th>
                <th scope="col" className={TH}>Важность</th>
                <th scope="col" className={TH}>Описание</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r, i) => (
                <tr key={i}>
                  <td className={`${TD} text-xs`}>{r.scenarioTitle}</td>
                  <td className={`${TD} text-xs whitespace-nowrap`}>{r.severity}</td>
                  <td className={`${TD} text-xs`}>
                    {r.text} <span className="font-mono text-muted-foreground">[{r.code}]</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ——————————————————————————— Формулы ———————————————————————————

function FormulasSection() {
  const rows = formulaRows();
  return (
    <Section id="formulas" title="Формулы">
      <Note>
        Формулы модели {TZ_MODEL_VERSION}. Источник: «ТЗ» — расчётные зависимости ТЗ, «организатор» — легенда датасета
        организатора, «наш выбор» — решение модели, обоснованное в методике.
      </Note>
      <div className={TABLE_WRAP}>
        <table className={TABLE}>
          <thead className="border-b">
            <tr>
              <th scope="col" className={TH}>Показатель</th>
              <th scope="col" className={TH}>Формула</th>
              <th scope="col" className={TH}>Единицы</th>
              <th scope="col" className={TH}>Источник</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.key}>
                <th scope="row" className={`${TD} text-left font-normal`}>{f.title}</th>
                <td className={`${TD} font-mono text-xs break-words`}>{f.expression}</td>
                <td className={`${TD} text-xs`}>{f.units}</td>
                <td className={`${TD} text-xs whitespace-nowrap`}>{f.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ——————————————————————————— Нормативы ———————————————————————————

function NormsSection({ results }: { results: ProjectResults }) {
  const rows = normsReportRows(results);
  const overrides = normOverrideRows(results);
  const groups = groupInOrder<NormReportRow>(rows, (r) => r.group);
  return (
    <Section id="norms" title="Нормативы и допущения">
      <Note>
        Нормативы, с которыми выполнен расчёт (снимок проекта): значение, происхождение и обоснование. Значение, отличное от
        значения по умолчанию, изменено администратором и отмечено.
      </Note>
      <div className={TABLE_WRAP}>
        <table className={TABLE}>
          <thead className="border-b">
            <tr>
              <th scope="col" className={TH}>Норматив</th>
              <th scope="col" className={`${TH} text-right`}>Значение</th>
              <th scope="col" className={TH}>Ед.</th>
              <th scope="col" className={TH}>Происхождение</th>
              <th scope="col" className={TH}>Обоснование и источник</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.name}>
              <tr>
                <th scope="colgroup" colSpan={5} className="border-t bg-muted/20 px-2 py-1 text-left text-xs font-semibold">
                  {g.name}
                </th>
              </tr>
              {g.items.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className={`${TD} text-left font-normal`}>{r.label}</th>
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                    {normValueText(r.value, r.unit)}
                    {r.changed && (
                      <div className="text-xs text-caution">по умолчанию {normValueText(r.defaultValue, r.unit)}</div>
                    )}
                  </td>
                  <td className={`${TD} text-xs`}>{r.unit}</td>
                  <td className={`${TD} text-xs`}>{r.origin}</td>
                  <td className={`${TD} text-xs`}>
                    <div>{r.basis}</div>
                    {r.source !== "—" && <div className="mt-0.5 break-all text-muted-foreground">{r.source}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {overrides.length > 0 && (
        <>
          <h3 className="text-base font-semibold">Нормативы, переопределённые в сценариях</h3>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
            {overrides.map((o, i) => (
              <li key={i}>
                {o.scenarioTitle}: {o.label} = {normValueText(o.value, o.unit)} {o.unit}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

// ——————————————————————————— Ограничения ———————————————————————————

function LimitationsSection({ results }: { results: ProjectResults }) {
  const selection = scenarioSelectionLimitations(results);
  return (
    <Section id="limitations" title="Ограничения модели">
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {modelLimitations().map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {selection.length > 0 && (
        <>
          <h3 className="text-base font-semibold">Ограничения решений в сценариях (по данным подбора)</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {selection.map((l, i) => (
              <li key={i}>
                <span className="font-medium">{l.product}:</span> {l.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

// ——————————————————————————— Источники ———————————————————————————

function SourcesSection({ results }: { results: ProjectResults }) {
  const rows = sourcesRows(results);
  const products: { name: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const last = products[products.length - 1];
    if (last && last.name === r.productName) last.rows.push(r);
    else products.push({ name: r.productName, rows: [r] });
  }
  return (
    <Section id="sources" title="Источники данных">
      <Note>
        Характеристики решений, с которыми выполнен расчёт (снимок проекта): значение, происхождение, дата проверки, признак
        подтверждения первоисточником и ссылка. Источники параметров объекта — в разделе «Параметры объекта», нормативов — в
        разделе «Нормативы и допущения».
      </Note>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">В расчёте нет решений из каталога.</p>
      ) : (
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead className="border-b">
              <tr>
                <th scope="col" className={TH}>Характеристика</th>
                <th scope="col" className={TH}>Значение</th>
                <th scope="col" className={TH}>Происхождение</th>
                <th scope="col" className={TH}>Подтверждено</th>
                <th scope="col" className={TH}>Дата</th>
                <th scope="col" className={TH}>Источник</th>
              </tr>
            </thead>
            {products.map((p) => (
              <tbody key={p.name}>
                <tr>
                  <th scope="colgroup" colSpan={6} className="border-t bg-muted/20 px-2 py-1 text-left text-xs font-semibold">
                    {p.name}
                  </th>
                </tr>
                {p.rows.map((s) => {
                  const url = safeHttpUrl(s.url);
                  // Значение-ссылка (например, «Основной источник») — тоже в читаемом виде.
                  const valueUrl = safeHttpUrl(s.value);
                  return (
                    <tr key={`${s.productSlug}-${s.key}`}>
                      <th scope="row" className={`${TD} text-left text-xs font-normal`}>{s.label}</th>
                      <td className={cn(TD, "text-xs", valueUrl ? "break-all" : "break-words")}>
                        {valueUrl ? displayUrl(valueUrl) : s.value}
                      </td>
                      <td className={`${TD} text-xs`}>{s.origin}</td>
                      <td className={`${TD} text-xs`}>{s.confirmed ? "да" : "нет"}</td>
                      <td className={`${TD} text-xs whitespace-nowrap tabular-nums`}>{s.date ?? "—"}</td>
                      <td className={`${TD} text-xs`}>
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">
                            {displayUrl(url)}
                          </a>
                        )}
                        {s.ref && <div className="break-words text-muted-foreground">{s.ref}</div>}
                        {!url && !s.ref && "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Section>
  );
}

// ——————————————————————————— Журнал ———————————————————————————

function ChangesSection({ results, defs, changes }: { results: ProjectResults; defs: readonly ParamSpec[]; changes: readonly ReportChange[] }) {
  const rows = changeRows(changes, {
    paramLabels: Object.fromEntries(defs.map((d) => [d.key, d.label])),
    scenarioTitles: scenarioTitleMap(results),
  });
  return (
    <Section id="changes" title="Журнал корректировок">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Корректировок нет: все значения расчётные или взяты из данных организатора и каталога.
        </p>
      ) : (
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead className="border-b">
              <tr>
                <th scope="col" className={TH}>Когда</th>
                <th scope="col" className={TH}>Кто</th>
                <th scope="col" className={TH}>Сценарий</th>
                <th scope="col" className={TH}>Что изменено</th>
                <th scope="col" className={`${TH} text-right`}>Авто</th>
                <th scope="col" className={`${TH} text-right`}>Было</th>
                <th scope="col" className={`${TH} text-right`}>Стало</th>
                <th scope="col" className={TH}>Ед.</th>
                <th scope="col" className={TH}>Причина</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={i}>
                  <td className={`${TD} text-xs whitespace-nowrap tabular-nums`}>{c.at}</td>
                  <td className={`${TD} text-xs break-all`}>{c.user}</td>
                  <td className={`${TD} text-xs`}>{c.scenario}</td>
                  <td className={`${TD} text-xs`}>{c.fieldLabel}</td>
                  <td className={`${TD} text-right text-xs tabular-nums`}>{c.auto}</td>
                  <td className={`${TD} text-right text-xs tabular-nums`}>{c.old}</td>
                  <td className={`${TD} text-right text-xs font-medium tabular-nums`}>{c.new}</td>
                  <td className={`${TD} text-xs`}>{c.unit}</td>
                  <td className={`${TD} text-xs`}>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ——————————————————————————— Отчёт целиком ———————————————————————————

export function ProjectReport({ project, results, defs, changes, liveDataVersion = null }: ProjectReportProps) {
  return (
    <div className="report-print mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Toolbar projectId={project.id} />
      <ReportHeader project={project} results={results} liveDataVersion={liveDataVersion} />
      <ParamsSection results={results} defs={defs} />
      <SelectionSection results={results} />
      <EquipmentSection results={results} />
      <EconomicsSection results={results} defs={defs} />
      <LinesSection results={results} />
      <CashflowSection results={results} />
      <SensitivitySection results={results} />
      <SimSection results={results} />
      <ConclusionSection results={results} />
      <FormulasSection />
      <NormsSection results={results} />
      <LimitationsSection results={results} />
      <SourcesSection results={results} />
      <ChangesSection results={results} defs={defs} changes={changes} />
      <p className="mt-8 border-t pt-2 text-xs text-muted-foreground">
        Отчёт построен по сохранённому расчёту проекта «{project.name}» ({formatCalcDate(results.calculatedAt)}): повторное
        открытие проекта с теми же версиями модели ({results.modelVersion}, {results.simModelVersion}) и данных (
        {results.dataVersion}) воспроизводит эти числа.
      </p>
    </div>
  );
}

/** Проект без сохранённого расчёта: отчёт строится только по сохранённым результатам. */
export function ReportNeedsSave({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold">Отчёт по проекту: {projectName}</h1>
      <p className="text-muted-foreground">Сохраните проект, чтобы построить отчёт.</p>
      <p className="text-sm text-muted-foreground">
        Отчёт, файлы Excel и CSV строятся из сохранённого расчёта — так числа в них совпадают и воспроизводятся при повторном
        открытии проекта.
      </p>
      <Link href={`/projects/${projectId}`} className="self-start rounded-md border px-3 py-2 text-sm font-medium">
        Вернуться к проекту
      </Link>
    </div>
  );
}
