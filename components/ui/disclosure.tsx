"use client";

import { useId, useState } from "react";

/**
 * Раскрытие «откуда это число» рядом с самим числом.
 *
 * Кнопка, а не всплывающая подсказка: подсказка недоступна с клавиатуры, бесполезна на
 * телефоне и не попадает в печать. Раскрытый блок стоит под строкой, а не поверх неё, чтобы
 * ничего не перекрывать и не исчезать при уводе курсора.
 */
export function Disclosure({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        // Имя СТАБИЛЬНО, состояние несёт aria-expanded. Имя, меняющееся вместе с состоянием,
        // при наличии aria-expanded — это то же противоречие, что «Продолжить, нажато» на
        // кнопке паузы: два источника про одно и то же, спорящие друг с другом. Заголовок
        // включён в имя потому, что «показать объяснение» в списке из десяти одинаковых
        // кнопок не говорит скринридеру ничего.
        aria-label={`Объяснить: ${title}`}
        // Знак вопроса рисуется псевдоэлементом, а не текстовым узлом. Текстовый «?» попадал
        // в innerText строки показателя и ломал паритет-тесты панели и отчёта: они сравнивают
        // «подпись: значение», а значение приезжало как «152 529 667 ₽ (US$1,694,774) ?».
        // Тесты были правы — это презентация утекала в текст.
        className="ml-1.5 inline-grid size-[18px] place-items-center rounded-full border
          border-muted-foreground/40 align-middle text-[11px] leading-none text-muted-foreground
          transition-colors before:content-['?'] hover:border-primary hover:text-primary
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      {open && (
        <div
          id={id}
          // no-print: в отчёте источники и формулы идут отдельным разделом, как в любом
          // документе, который читают на бумаге, — а не десятью раскрытыми блоками посреди
          // таблицы показателей.
          className="no-print mt-1.5 mb-2 rounded-md border-l-2 border-primary/40 bg-muted/40
            px-3 py-2 text-sm text-muted-foreground"
        >
          <div className="font-medium text-foreground">{title}</div>
          <p className="mt-1">{body}</p>
        </div>
      )}
    </>
  );
}
