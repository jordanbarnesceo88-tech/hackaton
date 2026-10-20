import Link from "next/link";
import { paramSpecsFor } from "@/lib/data/organizer/params";
import { FACILITY_LABELS } from "@/lib/tz/params/template";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Какие данные нужны — Платформа оценки роботизации" };

export default function DataRequirementsPage() {
  return <div className="surface-data grid gap-8 py-8">
    <header className="grid max-w-4xl gap-3"><h1>Какие данные нужны для расчёта</h1><p>Соберите данные об объёме работы, персонале, ограничениях объекта и коммерческом предложении. Укажите источник и дату каждого рабочего допущения. Неизвестная величина остаётся неизвестной — её нельзя заменять нулём.</p></header>
    <section className="grid gap-3"><h2>Перед началом</h2><ul className="grid max-w-4xl list-disc gap-2 pl-5">
      <li>Объём работы: площадь и кратность уборки либо поток перевозок, пиковые часы, смены и рабочие дни.</li>
      <li>Люди: численность по процессам, сменная ставка или начисленная зарплата, налоги, подрядчик, какие расходы реально сократятся.</li>
      <li>План объекта: масштаб, препятствия, проходы, зоны и этажи; питание, вода, станции, лифты и ограничения доступа.</li>
      <li>Роботы: точная модель, рабочая выработка и режим замера, циклы работы/зарядки, ежедневный уход. Паспортный максимум указывается отдельно.</li>
      <li>Деньги: цена покупки или RaaS, НДС, первый месяц, включённые услуги, расходники, АКБ, платформа, доставка, срок и источник предложения.</li>
      <li>Пилот: участок, срок, критерии приёмки и ответственный; затем фактически принятая работа, доработка, простои, инциденты и оценка заказчика.</li>
    </ul></section>
    {(["warehouse", "airport", "medical"] as const).map(facility => <section key={facility} className="grid min-w-0 gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3"><h2>{FACILITY_LABELS[facility]}</h2><Link href={`/api/templates/${facility}`} className={buttonVariants({ variant: "outline", size: "lg" })}>Скачать шаблон параметров</Link></header>
      <div className="data-table-wrap" role="region" aria-label={`Исходные параметры: ${FACILITY_LABELS[facility]}`} tabIndex={0}><table className="data-table"><thead><tr><th scope="col">Что подготовить</th><th scope="col">Единица</th><th scope="col">Где взять и как проверить</th></tr></thead><tbody>{paramSpecsFor(facility).map(def => <tr key={def.key}><th scope="row" className="text-left font-medium">{def.label}{def.required ? " · обязательно" : ""}</th><td>{def.unit || "—"}</td><td className="min-w-64">{def.basis || "План объекта, учёт операций, табели или подтверждённое предложение поставщика; при отсутствии задайте явную оценку с основанием."}{def.base !== null ? ` Пример из исходного набора: ${String(def.base)}.` : " Без исходного значения."}{def.min !== null || def.max !== null ? ` Диапазон: ${def.min ?? "не задан"} — ${def.max ?? "не задан"}.` : ""}</td></tr>)}</tbody></table></div>
    </section>)}
    <footer className="flex flex-wrap gap-4"><Link href="/demo" className={buttonVariants({ size: "lg" })}>Перейти к расчёту</Link><Link href="/methodology/tz" className={buttonVariants({ variant: "outline", size: "lg" })}>Методика и ограничения</Link></footer>
  </div>;
}
