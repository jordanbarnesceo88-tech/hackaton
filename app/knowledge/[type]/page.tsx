import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { implementationGuide, IMPLEMENTATION_VERSION } from "@/lib/implementation/guides";
import { implementationResources } from "@/lib/implementation/resources";
import { ModelResources } from "@/components/implementation/model-resources";

type Props = { params: Promise<{ type: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = implementationGuide((await params).type);
  return { title: guide ? `${guide.title}: подготовка и пилот` : "Класс решения не найден" };
}

export default async function ClassKnowledgePage({ params }: Props) {
  const guide = implementationGuide((await params).type);
  if (!guide) notFound();
  return <div className="mx-auto grid w-full max-w-5xl min-w-0 gap-6 px-4 py-8">
    <Link className="tap-target w-fit text-sm text-primary underline" href="/knowledge">← Подготовка к внедрению</Link>
    <header className="grid gap-3"><h1>{guide.title}: подготовка и пилот</h1><p>{guide.scope}</p><p className="text-sm text-muted-foreground">Методический шаблон платформы · {IMPLEMENTATION_VERSION}. Для запуска нужны инструкции конкретной модели, обследование объекта и согласованная программа испытаний.</p></header>
    {([
      ["Узкие места", guide.bottlenecks], ["Подготовка объекта", guide.preparation],
      ["Как принимать пилот", guide.acceptance], ["Инженеру: эксплуатация и разбор отказов", guide.operations],
      ["Заказчику: как пройти от пилота к внедрению", guide.customer],
    ] as const).map(([title, items]) => <section key={title} className="grid gap-3 border-t pt-4"><h2>{title}</h2><ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">{items.map(item => <li key={item}>{item}</li>)}</ul></section>)}
    <ModelResources resources={implementationResources(guide.solutionType)} />
    <p className="text-sm text-muted-foreground">Контакты обслуживания и происхождение сведений показаны в карточке конкретного робота и в плане пилота. Выработка считается принятой после проверки результата заказчиком, а не по одному факту движения робота.</p>
    <Link href={`/catalog?solutionType=${encodeURIComponent(guide.solutionType)}`} className="tap-target w-fit text-primary underline">Решения этого класса в каталоге →</Link>
  </div>;
}
