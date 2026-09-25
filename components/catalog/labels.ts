import type { CatalogSort } from "@/lib/catalog/queries";
import type { ProductLevel, ProductStatus } from "@/lib/tz/types";

/**
 * Подписи публичного каталога (ТЗ §3.3): статусы, глубина описания, сортировки, достоверность.
 * Модуль без React и без обращения к БД — его импортируют и серверные страницы, и клиентская
 * форма сравнения, и тесты.
 */

/** Текст для отсутствующего значения: «нет данных», а не ноль и не пустая ячейка. */
export const NO_DATA = "нет данных";

/** Статус продукта из каталога организатора — как в фильтре «Статус» (§3.3.7). */
export const STATUS_LABELS: Readonly<Record<ProductStatus, string>> = {
  operation: "в эксплуатации",
  piloting: "пилот",
  rnd: "НИОКР",
};

/** Тон бейджа статуса (data-tone на .badge, app/globals.css): серийная эксплуатация — спокойный,
    пилот — предупреждающий, НИОКР — нейтральный (без data-tone, .badge даёт muted-foreground). */
export const STATUS_TONE: Readonly<Record<ProductStatus, "ok" | "warn" | undefined>> = {
  operation: "ok",
  piloting: "warn",
  rnd: undefined,
};

/** Глубина описания продукта — насколько карточка заполнена характеристиками с источниками. */
export const LEVEL_LABELS: Readonly<Record<ProductLevel, string>> = {
  identification: "только идентификация",
  enriched: "характеристики с источниками",
  examples: "из «Примеров решений» организатора",
};

/**
 * Пояснение к глубине описания — только о том, насколько карточка заполнена и откуда её данные.
 * Участвует ли продукт в подборе, зависит ещё от архива, исключения и привязки к процессам;
 * это говорит `selectionParticipation` (product-card.tsx), а не глубина описания.
 */
export const LEVEL_HINTS: Readonly<Record<ProductLevel, string>> = {
  identification:
    "Карточка содержит только поля каталога организатора (название, тип, статус, компания, цена); " +
    "технических характеристик с источниками нет.",
  enriched:
    "Характеристики найдены у производителя и в открытых источниках; у каждой указаны источник, " +
    "дата проверки и признак подтверждения.",
  examples: "Характеристики взяты из документа организатора «Примеры решений».",
};

/** Варианты сортировки списка в порядке показа в фильтре. */
export const SORT_OPTIONS: readonly { value: CatalogSort; label: string }[] = [
  { value: "name", label: "по названию" },
  { value: "price", label: "по цене (сначала дешевле)" },
  { value: "throughput", label: "по производительности (сначала выше)" },
  { value: "completeness", label: "по полноте данных" },
];

/** Достоверность значения из исследования (поле confidence характеристики). */
export const CONFIDENCE_LABELS: Readonly<Record<string, string>> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

/** Подпись достоверности; неизвестное значение показывается как есть, пустое — null. */
export function confidenceLabel(confidence: string | null | undefined): string | null {
  const c = (confidence ?? "").trim();
  if (c === "") return null;
  return Object.prototype.hasOwnProperty.call(CONFIDENCE_LABELS, c) ? (CONFIDENCE_LABELS[c] ?? c) : c;
}

/** Подпись чипа «требует проверки» — та же, что в подборе (components/project). */
export const NEEDS_VERIFICATION_CHIP = "требует проверки";

/** Подпись чипа для продукта, описанного только полями каталога организатора. */
export const IDENTIFICATION_ONLY_CHIP = "только идентификация";

/** Подпись чипа для продукта, который подбор исключает (НИОКР, модель не найдена и т. п.). */
export const EXCLUDED_CHIP = "не участвует в подборе";

/** Подпись чипа архивного продукта: в списке и подборе его нет, карточка открывается по ссылке. */
export const ARCHIVED_CHIP = "в архиве";

/** Нейтральный бейдж-метка каталога (BCB `.chip`: бордер, без точки, без цветового тона). */
export const CHIP_CLASS = "chip max-w-full whitespace-nowrap";

/** Статусный бейдж (BCB `.badge`: без бордера, точка-индикатор, цвет через data-tone). */
export const BADGE_CLASS = "badge max-w-full whitespace-nowrap";
