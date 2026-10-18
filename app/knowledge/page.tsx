import type { Metadata } from "next";
import Link from "next/link";
import { IMPLEMENTATION_CLASSES, implementationGuide } from "@/lib/implementation/guides";

export const metadata: Metadata = { title: "Подготовка к внедрению — Платформа оценки роботизации" };

export default function KnowledgePage() {
  return <div className="mx-auto grid w-full max-w-5xl min-w-0 gap-6 px-4 py-8">
    <header className="grid gap-3"><h1>От расчёта к внедрению</h1><p>Выберите класс решения: ограничения объекта, подготовка, критерии пилота и эксплуатация.</p><p className="text-sm text-muted-foreground">Это методические шаблоны. Они помогают составить программу пилота вместе с интегратором; пороги приёмки и условия обслуживания согласуются до запуска.</p></header>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{IMPLEMENTATION_CLASSES.map(type => {
      const guide = implementationGuide(type)!;
      return <Link key={type} href={`/knowledge/${type}`} className="grid min-w-0 gap-2 rounded border p-4 text-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><h2 className="font-semibold text-primary">{guide.title} →</h2><p>{guide.scope}</p></Link>;
    })}</div>
  </div>;
}

