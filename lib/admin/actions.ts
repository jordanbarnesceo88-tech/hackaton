"use server";

import type { Prisma, ProductCharacteristic } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { charGroupOf, formatCharValue, isCharKey, isCharPresent, isoDate } from "@/lib/catalog/product-for-calc";
import type { CharRow, CharRowFull } from "@/lib/catalog/product-for-calc";
import { promoteColumns } from "@/lib/catalog/promote";
import { toCharacteristicData } from "@/lib/catalog/queries";
import type { Db } from "@/lib/catalog/queries";
import { STALE_SOURCE_DAYS, changedTotal, formatSyncReport, syncOrganizerData } from "@/lib/catalog/sync";
import { catalogProduct } from "@/lib/data/organizer/catalog";
import { prisma } from "@/lib/db/client";
import { parseRuNumber } from "@/lib/files/csv";
import { CHARACTERISTIC_KEYS } from "@/lib/tz/characteristics";
import type { CharKey } from "@/lib/tz/characteristics";
import { fx } from "@/lib/tz/econ/text";
import { isNormKey, normDef } from "@/lib/tz/norms";
import { coerce, isNumericKind, isOutOfRange } from "@/lib/tz/params/schema";
import type { ParamKind, ParamSpec } from "@/lib/tz/types";

/*
 * Серверные действия администратора (ТЗ §3.1.1 — роль «администратор»; §3.1.4 и §3.3.5 —
 * администратор управляет каталогом, справочниками, значениями по умолчанию и источниками;
 * §3.3.6 — обновление каталога по запросу; §3.5.4 — изменения фиксируются в журнале).
 *
 * Каждое действие устроено одинаково:
 * 1. `requireAdmin()` — первой строкой и вне try: роль перечитывается из базы, пользователь
 *    без роли ADMIN получает 404 (notFound), гость — /login. Проверка в layout админки
 *    действия не защищает: серверное действие достижимо прямым POST-запросом в обход страниц.
 * 2. Проверка ввода: неверное значение отклоняется с сообщением «что не так и как исправить»,
 *    а не подчищается молча. Исключение — норматив: он прижимается к [min, max] (так же, как
 *    его прижимает расчёт в resolveNorms), и сообщение говорит, какое число сохранено.
 * 3. Запись в одной транзакции вместе со строками журнала ChangeLog (entity, entityId, поле,
 *    было, стало, кто). Строки администратора не относятся к проекту (projectId = null) — так
 *    их отличает страница «Данные».
 * 4. revalidatePath — страница, с которой пришло действие, перерисовывается тем же ответом.
 *
 * Файл с «use server» экспортирует только асинхронные функции; типы стираются при сборке.
 * Действия принимают (предыдущее состояние, FormData) — форма useActionState.
 *
 * Что пишется в журнал (entity / entityId / field):
 * - product / id продукта / поле идентификации (name, status, archived…), create, delete, revert;
 * - characteristic / id продукта / ключ характеристики (так все правки карточки находятся
 *   одним запросом по (entity, entityId), и запись переживает удаление строки характеристики
 *   кнопкой «Вернуть данные организатора»). Характеристики, которые повторяют поля
 *   идентификации, и производные строки «Качества данных» отдельно не пишутся: первые —
 *   копия поля продукта (его строка в журнале есть), вторые — расчёт по остальным;
 * - norm / ключ норматива / value (autoValue — значение по умолчанию из кода);
 * - paramDefinition / id строки ParamDefinition / base, min, max, required, hint, example;
 * - catalog / версия данных / refresh — кнопка «Обновить каталог».
 */

// ——————————————————————————— Состояние формы ———————————————————————————

/** Состояние формы администратора (useActionState). */
export type AdminFormState = {
  status: "idle" | "ok" | "error";
  /** Итог по-русски: что сохранено или что исправить. */
  message: string;
  /**
   * Номер успешного сохранения. Форма ставит его ключом полей: после успеха поля
   * перемонтируются и показывают сохранённые значения, после ошибки введённое не теряется.
   */
  seq: number;
  /** Отчёт синхронизации построчно (обновление каталога). */
  report?: string[];
};

const MSG = {
  badRequest: "Форма пришла в неожиданном виде — обновите страницу и попробуйте ещё раз",
  productNotFound: "Продукт не найден — возможно, его удалили. Обновите страницу",
  unchanged: "Изменений нет — значения совпадают с сохранёнными",
  error: "Не удалось сохранить, попробуйте ещё раз",
  inProjects: "Продукт используется в проектах — переведите его в архив вместо удаления",
  organizerDelete: "Удалить нельзя: данные организатора — используйте «В архив»",
} as const;

function seqOf(prev: unknown): number {
  const seq = (prev as { seq?: unknown } | null | undefined)?.seq;
  return typeof seq === "number" && Number.isInteger(seq) && seq >= 0 ? seq : 0;
}

function ok(seq: number, message: string, report?: string[]): AdminFormState {
  return report ? { status: "ok", message, seq: seq + 1, report } : { status: "ok", message, seq: seq + 1 };
}

function fail(seq: number, message: string): AdminFormState {
  return { status: "error", message, seq };
}

// ——————————————————————————— Разбор полей формы ———————————————————————————

/**
 * Текстовое поле формы без крайних пробелов; нет поля — пустая строка. Переводы строк
 * приводятся к «\n»: браузер отправляет содержимое textarea с «\r\n», а хранится и показывается
 * оно с «\n» — без приведения повторное сохранение того же текста выглядело бы правкой.
 */
function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
}

/** Флажок формы: отмеченный checkbox присылает «on». */
function checked(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "1" || v === "true" || v === "yes";
}

/** Slug продукта из скрытого поля: непустой, без пробелов, разумной длины. */
function slugOf(fd: FormData): string | null {
  const s = field(fd, "slug");
  return s !== "" && s.length <= 160 && !/\s/.test(s) ? s : null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** Необязательное число в русской записи: пусто — null, мусор — сообщение об ошибке. */
function optionalNumber(fd: FormData, name: string, label: string): Parsed<number | null> {
  const raw = field(fd, name);
  if (raw === "") return { ok: true, value: null };
  const n = parseRuNumber(raw);
  if (n === null) {
    return { ok: false, message: `${label}: «${raw}» — не число. Введите число, например 1 500 или 0,85` };
  }
  return { ok: true, value: n };
}

/** Строка не длиннее `max` знаков; пустая — null. */
function optionalText(fd: FormData, name: string, label: string, max: number): Parsed<string | null> {
  const raw = field(fd, name);
  if (raw === "") return { ok: true, value: null };
  if (raw.length > max) return { ok: false, message: `${label}: не длиннее ${max} знаков — сейчас ${raw.length}` };
  return { ok: true, value: raw };
}

/**
 * Ссылка на источник: только http(s). Администратор вводит её руками, а карточка каталога
 * показывает её ссылкой, поэтому «javascript:» и прочие схемы не принимаются.
 */
function optionalUrl(fd: FormData, name: string): Parsed<string | null> {
  const raw = field(fd, name);
  if (raw === "") return { ok: true, value: null };
  const bad = { ok: false as const, message: `Ссылка «${raw.slice(0, 80)}» — не адрес страницы. Вставьте ссылку вида https://сайт/страница` };
  if (raw.length > 500) return { ok: false, message: "Ссылка длиннее 500 знаков — сократите её до адреса страницы" };
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return bad;
    if (/\s/.test(raw)) return bad;
  } catch {
    return bad;
  }
  return { ok: true, value: raw };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Дата проверки из <input type="date">: ГГГГ-ММ-ДД, существующая и не из будущего. */
function optionalDate(fd: FormData, name: string): Parsed<string | null> {
  const raw = field(fd, name);
  if (raw === "") return { ok: true, value: null };
  const d = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isoDate(d) !== raw) {
    return { ok: false, message: `Дата проверки «${raw}» не распознана — выберите дату в календаре (ГГГГ-ММ-ДД)` };
  }
  // Сутки запаса: администратор в часовом поясе восточнее UTC уже живёт «завтра».
  const latest = isoDate(new Date(Date.now() + DAY_MS));
  if (latest !== null && raw > latest) {
    return { ok: false, message: "Дата проверки не может быть в будущем — укажите день, когда вы сверили значение" };
  }
  return { ok: true, value: raw };
}

// ——————————————————————————— Ошибки записи ———————————————————————————

/** Код ошибки Prisma (P2002, P2003 …) или null. */
function prismaCode(e: unknown): string | null {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string"
    ? (e as { code: string }).code
    : null;
}

/** Сообщение об ошибке записи по коду Prisma. */
function writeError(e: unknown): string {
  switch (prismaCode(e)) {
    case "P2003":
      return MSG.inProjects;
    case "P2002":
      return "Запись с таким ключом уже есть — измените название и повторите";
    case "P2025":
      return "Запись не найдена — возможно, её удалили. Обновите страницу";
    default:
      return MSG.error;
  }
}

// ——————————————————————————— Журнал ———————————————————————————

type AdminEntity = "product" | "characteristic" | "norm" | "paramDefinition" | "catalog";

type LogEntry = {
  entity: AdminEntity;
  entityId: string;
  field: string;
  autoValue?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
  unit?: string | null;
  reason?: string | null;
};

/** JSON-значение для журнала; пустое значение не передаётся — колонка получает SQL NULL. */
function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  return v as Prisma.InputJsonValue;
}

function logRows(userId: string, entries: readonly LogEntry[]): Prisma.ChangeLogCreateManyInput[] {
  return entries.map((e) => ({
    entity: e.entity,
    entityId: e.entityId,
    userId,
    field: e.field,
    autoValue: json(e.autoValue),
    oldValue: json(e.oldValue),
    newValue: json(e.newValue),
    unit: e.unit ?? null,
    reason: e.reason ?? null,
  }));
}

async function writeLog(tx: Db, userId: string, entries: readonly LogEntry[]): Promise<void> {
  if (entries.length > 0) await tx.changeLog.createMany({ data: logRows(userId, entries) });
}

/** Сравнение значений для «изменилось ли поле»: массивы и объекты — по JSON. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// ——————————————————————————— Перерисовка страниц ———————————————————————————

/** Все страницы админки: общий layout. */
function revalidateAdmin(): void {
  revalidatePath("/admin", "layout");
}

/** Админка и гостевой каталог — после правок продукта. */
function revalidateCatalog(): void {
  revalidateAdmin();
  revalidatePath("/catalog", "layout");
}

// ——————————————————————————— Производные строки карточки ———————————————————————————

/** Ключи «Качества данных», которые генератор данных выводит из остальных характеристик. */
const DERIVED_QUALITY_KEYS: ReadonlySet<string> = new Set(["primarySourceUrl", "verifiedAt", "confirmation"]);

/** Первая часть текста «Подтверждение»: «9 из 31 подтверждены». */
const CONFIRMED_PART = /^\d+ из \d+ подтверждены$/;

/** Самая поздняя дата ГГГГ-ММ-ДД из списка; пустой список — null. */
function latestDate(dates: readonly (string | null)[]): string | null {
  return dates.reduce<string | null>((max, d) => (d !== null && (max === null || d > max) ? d : max), null);
}

/**
 * Пересчитать производные строки «Качества данных» после правки характеристик — по тем же
 * формулам, что у генератора данных (scripts/gen-organizer-seed.ts, addDataQuality), иначе
 * строка «Подтверждение» продолжала бы показывать прежнее число подтверждённых значений:
 * - «Подтверждение» — «N из M подтверждены» (formula «confirmed / всего»): M — заполненные
 *   характеристики продукта без строк качества данных, N — подтверждённые из них; остальные
 *   части текста («строка свода: да») не меняются;
 * - «Дата проверки» — самая поздняя дата проверки тех же характеристик (formula «max(date)»);
 *   этой же датой помечены обе пересчитанные строки, как у генератора.
 * Пересчитываются только строки с происхождением «расчёт» (derived): строку, которую правил
 * администратор, пересчёт не трогает; у продукта администратора таких строк нет вовсе.
 * Возвращает итоговый набор характеристик продукта — из него считаются вынесенные колонки.
 */
async function refreshDerivedQuality(tx: Db, productId: string): Promise<ProductCharacteristic[]> {
  const all = await tx.productCharacteristic.findMany({ where: { productId } });
  const base = all.filter((c) => !DERIVED_QUALITY_KEYS.has(c.key) && isCharPresent(toCharRow(c)));
  const latest = latestDate(base.map((c) => isoDate(c.verifiedAt)));
  const date = latest === null ? undefined : new Date(`${latest}T00:00:00Z`);
  const want = new Map<string, { valueText: string; verifiedAt?: Date }>();

  const confirmation = all.find((c) => c.key === "confirmation" && c.origin === "derived");
  if (confirmation) {
    const head = `${base.filter((c) => c.confirmed).length} из ${base.length} подтверждены`;
    const rest = (confirmation.valueText ?? "").split("; ").filter((p) => p !== "" && !CONFIRMED_PART.test(p));
    want.set(confirmation.id, { valueText: [head, ...rest].join("; "), verifiedAt: date });
  }
  const verified = all.find((c) => c.key === "verifiedAt" && c.origin === "derived");
  if (verified && latest !== null) want.set(verified.id, { valueText: latest, verifiedAt: date });

  const out: ProductCharacteristic[] = [];
  for (const c of all) {
    const w = want.get(c.id);
    const sameDate = w?.verifiedAt === undefined || isoDate(c.verifiedAt) === isoDate(w.verifiedAt);
    if (!w || (c.valueText === w.valueText && sameDate)) {
      out.push(c);
      continue;
    }
    out.push(await tx.productCharacteristic.update({ where: { id: c.id }, data: w }));
  }
  return out;
}

/**
 * Характеристика идентификации, которая повторяет поле продукта в карточке (ТЗ §3.3.4,
 * группа «Идентификация»): без неё после переименования заголовок карточки и строка
 * «Наименование (модель)» показывали бы разное.
 */
const IDENTITY_CHAR_KEYS = {
  name: "modelName",
  manufacturer: "manufacturer",
  country: "countryOfOrigin",
  solutionType: "solutionType",
  status: "availabilityStatus",
} as const satisfies Record<string, CharKey>;

type IdentityField = keyof typeof IDENTITY_CHAR_KEYS;

function isIdentityField(k: string): k is IdentityField {
  return Object.prototype.hasOwnProperty.call(IDENTITY_CHAR_KEYS, k);
}

/**
 * Записать поле идентификации в его характеристику строкой администратора (adminChar):
 * новое значение, дата — сегодня, без источника и без «подтверждено». Очищенное поле
 * (производитель, страна, тип решения) очищает и характеристику — строка администратора без
 * значения не считается заполненной и не даёт синхронизации вернуть прежнее значение.
 * Другие найденные значения (alternatives) у существующей строки остаются.
 */
async function writeIdentityChar(
  tx: Db,
  productId: string,
  key: CharKey,
  valueText: string | null,
  today: string,
): Promise<void> {
  const note =
    valueText === null
      ? "Очищено администратором в разделе «Идентификация»"
      : "Изменено администратором в разделе «Идентификация»";
  const data = toCharacteristicData(adminChar(key, { valueText, note }, today));
  const old = await tx.productCharacteristic.findUnique({ where: { productId_key: { productId, key } } });
  if (old) {
    await tx.productCharacteristic.update({ where: { id: old.id }, data: { ...data, alternatives: undefined } });
  } else if (valueText !== null) {
    await tx.productCharacteristic.create({ data: { ...data, product: { connect: { id: productId } } } });
  }
}

// ——————————————————————————— Продукты: поля идентификации ———————————————————————————

const STATUSES = ["operation", "piloting", "rnd"] as const;
type Status = (typeof STATUSES)[number];

/** Текст статуса доступности — как в каталоге организатора (характеристика availabilityStatus). */
const STATUS_TEXT: Readonly<Record<Status, string>> = {
  operation: "в эксплуатации",
  piloting: "пилотирование",
  rnd: "НИОКР",
};

function isStatus(v: string): v is Status {
  return (STATUSES as readonly string[]).includes(v);
}

type IdentityInput = {
  name: string;
  manufacturer: string | null;
  country: string | null;
  /** Slug типа решения; "" — без типа. */
  solutionType: string;
  status: Status;
};

/** Название, производитель, страна, тип решения и статус — общие для создания и правки. */
function parseIdentity(fd: FormData): Parsed<IdentityInput> {
  const name = field(fd, "name");
  if (name === "") return { ok: false, message: "Укажите название продукта, например «Ronavi H1500»" };
  if (name.length > 200) return { ok: false, message: `Название не длиннее 200 знаков — сейчас ${name.length}` };
  const manufacturer = optionalText(fd, "manufacturer", "Производитель", 200);
  if (!manufacturer.ok) return manufacturer;
  const country = optionalText(fd, "country", "Страна", 100);
  if (!country.ok) return country;
  const solutionType = field(fd, "solutionType");
  if (solutionType.length > 80) return { ok: false, message: "Выберите тип решения из списка" };
  const status = field(fd, "status");
  if (!isStatus(status)) return { ok: false, message: "Выберите статус: эксплуатация, пилотирование или НИОКР" };
  return {
    ok: true,
    value: { name, manufacturer: manufacturer.value, country: country.value, solutionType, status },
  };
}

/** id типа решения по slug; "" — без типа; неизвестный slug — ошибка. */
async function solutionTypeIdOf(tx: Db, slug: string): Promise<Parsed<string | null>> {
  if (slug === "") return { ok: true, value: null };
  const st = await tx.solutionType.findUnique({ where: { slug }, select: { id: true } });
  if (!st) return { ok: false, message: `Тип решения «${slug}» не найден — выберите тип из списка` };
  return { ok: true, value: st.id };
}

type TxOutcome = { kind: "ok"; message: string } | { kind: "fail"; message: string };

/**
 * Правка идентификации продукта: название, производитель, страна, тип решения, статус,
 * исключение из подбора с причиной, архив. Продукт получает editedByAdmin = true — тогда
 * «Обновить каталог» не перезапишет правку данными организатора. Изменённое поле
 * идентификации записывается и в характеристику, которая его повторяет (название →
 * «Наименование (модель)», статус → «Статус доступности» …), строкой администратора; затем
 * пересчитываются «Качество данных» и вынесенные колонки. В журнал правка идёт одной строкой
 * по полю продукта — характеристика здесь только его копия.
 */
export async function updateProductAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const slug = slugOf(formData);
  if (!slug) return fail(seq, MSG.productNotFound);
  const identity = parseIdentity(formData);
  if (!identity.ok) return fail(seq, identity.message);
  const excluded = checked(formData, "excluded");
  const reasonText = optionalText(formData, "excludedReason", "Причина исключения", 300);
  if (!reasonText.ok) return fail(seq, reasonText.message);
  if (excluded && reasonText.value === null) {
    return fail(seq, "Укажите причину исключения — подбор показывает её пользователю (например, «модель снята с производства»)");
  }
  const archived = checked(formData, "archived");

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const product = await tx.catalogProduct.findUnique({
        where: { slug },
        include: { solutionType: { select: { slug: true } } },
      });
      if (!product) return { kind: "fail", message: MSG.productNotFound };
      const st = await solutionTypeIdOf(tx, identity.value.solutionType);
      if (!st.ok) return { kind: "fail", message: st.message };
      const stName = st.value
        ? ((await tx.solutionType.findUnique({ where: { id: st.value }, select: { name: true } }))?.name ?? null)
        : null;

      const before = {
        name: product.name,
        manufacturer: product.manufacturer,
        country: product.country,
        solutionType: product.solutionType?.slug ?? "",
        status: product.status,
        excluded: product.excluded,
        excludedReason: product.excludedReason,
        archived: product.archived,
      };
      const after = {
        ...identity.value,
        excluded,
        excludedReason: excluded ? reasonText.value : null,
        archived,
      };
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => !same(before[k], after[k]));
      if (changed.length === 0) return { kind: "fail", message: MSG.unchanged };

      // Поля идентификации повторены характеристиками карточки — они меняются вместе с полем,
      // а с ними полнота, «Подтверждение» и вынесенные колонки.
      const identityChanged = changed.filter(isIdentityField);
      let promoted: ReturnType<typeof promoteColumns> | null = null;
      if (identityChanged.length > 0) {
        const texts: Record<IdentityField, string | null> = {
          name: after.name,
          manufacturer: after.manufacturer,
          country: after.country,
          solutionType: stName,
          status: STATUS_TEXT[after.status],
        };
        const today = isoDate(new Date()) ?? "";
        for (const k of identityChanged) {
          await writeIdentityChar(tx, product.id, IDENTITY_CHAR_KEYS[k], texts[k], today);
        }
        const all = await refreshDerivedQuality(tx, product.id);
        promoted = promoteColumns(all.map(toCharRow), { flags: product.flags });
      }

      await tx.catalogProduct.update({
        where: { id: product.id },
        data: {
          name: after.name,
          manufacturer: after.manufacturer,
          country: after.country,
          solutionTypeId: st.value,
          status: after.status,
          excluded: after.excluded,
          excludedReason: after.excludedReason,
          archived: after.archived,
          editedByAdmin: true,
          ...(promoted ?? {}),
        },
      });
      await writeLog(
        tx,
        admin.userId,
        changed.map((k) => ({ entity: "product", entityId: product.id, field: k, oldValue: before[k], newValue: after[k] })),
      );
      return { kind: "ok", message: `Записано: изменено полей — ${changed.length}` };
    });
  } catch (e) {
    console.error("updateProductAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateCatalog();
  return ok(seq, outcome.message);
}

// ——————————————————————————— Продукты: создание ———————————————————————————

const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Slug продукта администратора: «admin-» + транслитерация названия. Префикс исключает
 * совпадение со slug'ом данных организатора — иначе следующий выпуск данных с таким slug'ом
 * синхронизация пропустила бы («под этим slug уже есть продукт администратора»).
 */
function adminSlugBase(name: string): string {
  const latin = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");
  const core = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `admin-${core === "" ? "product" : core}`;
}

/** Первый свободный slug: base, base-2, base-3 … */
async function freeSlug(tx: Db, base: string): Promise<string> {
  const taken = new Set(
    (await tx.catalogProduct.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Характеристика администратора в форме CharRowFull (для toCharacteristicData). */
function adminChar(key: string, v: Partial<CharRowFull>, today: string): CharRowFull {
  return {
    key,
    group: charGroupOf(key),
    valueNum: null,
    valueMin: null,
    valueMax: null,
    qualifier: null,
    valueText: null,
    valueList: [],
    unit: null,
    scope: null,
    origin: "admin",
    sourceType: "admin-edit",
    sourceUrl: null,
    sourceRef: null,
    verifiedAt: today,
    confirmed: false,
    confidence: null,
    asInSource: null,
    basis: null,
    formula: null,
    note: null,
    granularity: "field",
    alternatives: null,
    ...v,
  };
}

/**
 * «Создать продукт» (origin ADMIN). Идентификационные характеристики (производитель, модель,
 * страна, тип решения, статус доступности) пишутся строками с происхождением «администратор»,
 * остальные администратор заполняет в карточке. Продукт получает глубину enriched: если у него
 * отмечены процессы, он участвует в подборе своих объектов — с полнотой карточки и признаком
 * «требует проверки», посчитанными по тем же правилам, что у данных организатора.
 * При успехе — переход в карточку нового продукта.
 */
export async function createProductAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const identity = parseIdentity(formData);
  if (!identity.ok) return fail(seq, identity.message);
  const description = optionalText(formData, "description", "Описание", 200);
  if (!description.ok) return fail(seq, description.message);
  const processSlugs = [...new Set(formData.getAll("process").filter((v): v is string => typeof v === "string"))];
  if (processSlugs.length > 50) return fail(seq, MSG.badRequest);

  let created: { slug: string } | { error: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const st = await solutionTypeIdOf(tx, identity.value.solutionType);
      if (!st.ok) return { error: st.message };
      const stName = st.value
        ? ((await tx.solutionType.findUnique({ where: { id: st.value }, select: { name: true } }))?.name ?? null)
        : null;
      const processes = await tx.process.findMany({
        where: { slug: { in: processSlugs } },
        select: { id: true, slug: true, facilityTypes: { select: { facilityType: { select: { slug: true } } } } },
      });
      if (processes.length !== processSlugs.length) {
        return { error: "Один из отмеченных процессов не найден — обновите страницу и отметьте процессы заново" };
      }
      const facilityTypeSlugs = [...new Set(processes.flatMap((p) => p.facilityTypes.map((l) => l.facilityType.slug)))].sort();

      const today = isoDate(new Date()) ?? "";
      const note = "Задано администратором при создании продукта";
      const v = identity.value;
      const chars: CharRowFull[] = [adminChar("modelName", { valueText: v.name, note }, today)];
      if (v.manufacturer) chars.push(adminChar("manufacturer", { valueText: v.manufacturer, note }, today));
      if (v.country) chars.push(adminChar("countryOfOrigin", { valueText: v.country, note }, today));
      if (stName) chars.push(adminChar("solutionType", { valueText: stName, note }, today));
      chars.push(adminChar("availabilityStatus", { valueText: STATUS_TEXT[v.status], note }, today));

      const slug = await freeSlug(tx, adminSlugBase(v.name));
      const product = await tx.catalogProduct.create({
        data: {
          slug,
          level: "enriched",
          name: v.name,
          manufacturer: v.manufacturer,
          country: v.country,
          solutionTypeId: st.value,
          status: v.status,
          facilityTypeSlugs,
          description: description.value ?? "",
          origin: "ADMIN",
          editedByAdmin: true,
          ...promoteColumns(chars, { flags: [] }),
          processes: { create: processes.map((p) => ({ processId: p.id })) },
          characteristics: { create: chars.map((c) => toCharacteristicData(c)) },
        },
      });
      await writeLog(tx, admin.userId, [
        {
          entity: "product",
          entityId: product.id,
          field: "create",
          newValue: {
            slug,
            name: v.name,
            manufacturer: v.manufacturer,
            status: v.status,
            solutionType: v.solutionType || null,
            processes: processSlugs,
          },
        },
      ]);
      return { slug };
    });
  } catch (e) {
    console.error("createProductAction", e);
    return fail(seq, writeError(e));
  }
  if ("error" in created) return fail(seq, created.error);
  revalidateCatalog();
  redirect(`/admin/catalog/${created.slug}`);
}

// ——————————————————————————— Продукты: архив, удаление, возврат ———————————————————————————

/**
 * «В архив» / «Вернуть из архива». Архивный продукт не показывается в каталоге и не участвует
 * в подборе, но его снимок в сохранённых проектах остаётся (ТЗ §3.1.5). У продукта организатора
 * ставится editedByAdmin, иначе «Обновить каталог» вернул бы его из архива.
 */
export async function archiveProductAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const slug = slugOf(formData);
  if (!slug) return fail(seq, MSG.productNotFound);
  const mode = field(formData, "archived");
  if (mode !== "1" && mode !== "0") return fail(seq, MSG.badRequest);
  const archived = mode === "1";

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const product = await tx.catalogProduct.findUnique({ where: { slug }, select: { id: true, archived: true } });
      if (!product) return { kind: "fail", message: MSG.productNotFound };
      if (product.archived === archived) {
        return { kind: "fail", message: archived ? "Продукт уже в архиве" : "Продукт уже не в архиве" };
      }
      await tx.catalogProduct.update({ where: { id: product.id }, data: { archived, editedByAdmin: true } });
      await writeLog(tx, admin.userId, [
        { entity: "product", entityId: product.id, field: "archived", oldValue: product.archived, newValue: archived },
      ]);
      return {
        kind: "ok",
        message: archived
          ? "Продукт в архиве: в каталоге и подборе его больше нет, сохранённые проекты его сохраняют"
          : "Продукт возвращён из архива",
      };
    });
  } catch (e) {
    console.error("archiveProductAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateCatalog();
  return ok(seq, outcome.message);
}

/** Сколько сценариев проектов ссылаются на продукт (ScenarioSpec.items[].productSlug). */
async function scenarioUses(tx: Db, slug: string): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "Scenario"
    WHERE jsonb_path_exists(spec, '$.items[*] ? (@.productSlug == $slug)', jsonb_build_object('slug', ${slug}::text))`;
  return rows[0]?.n ?? 0;
}

/**
 * Удаление продукта — только заведённого администратором (origin ADMIN) и только с отметкой
 * «подтверждаю». Продукт организатора удалить нельзя: следующий «Обновить каталог» создал бы
 * его снова, а архив даёт тот же результат без потери истории. Продукт, на который ссылается
 * сценарий проекта, тоже не удаляется: «Пересчитать на актуальных данных» его бы не нашёл.
 * При успехе — переход к списку каталога.
 */
export async function deleteProductAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const slug = slugOf(formData);
  if (!slug) return fail(seq, MSG.productNotFound);
  if (field(formData, "confirm") !== "yes") {
    return fail(seq, "Удаление необратимо — отметьте «Подтверждаю удаление» и нажмите кнопку ещё раз");
  }

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const product = await tx.catalogProduct.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, origin: true },
      });
      if (!product) return { kind: "fail", message: MSG.productNotFound };
      if (product.origin !== "ADMIN") return { kind: "fail", message: MSG.organizerDelete };
      if ((await scenarioUses(tx, slug)) > 0) return { kind: "fail", message: MSG.inProjects };
      await tx.catalogProduct.delete({ where: { id: product.id } });
      await writeLog(tx, admin.userId, [
        { entity: "product", entityId: product.id, field: "delete", oldValue: { slug: product.slug, name: product.name } },
      ]);
      return { kind: "ok", message: "Продукт удалён" };
    });
  } catch (e) {
    console.error("deleteProductAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateCatalog();
  redirect("/admin/catalog");
}

/**
 * «Вернуть данные организатора»: удалить характеристики администратора, снять editedByAdmin
 * и синхронизировать продукт из данных организатора (syncOrganizerData с only: [slug]) — всё
 * в одной транзакции: если синхронизация не удалась, правки администратора остаются на месте.
 */
export async function revertProductAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const slug = slugOf(formData);
  if (!slug) return fail(seq, MSG.productNotFound);

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(
      async (tx): Promise<TxOutcome> => {
        const product = await tx.catalogProduct.findUnique({
          where: { slug },
          select: { id: true, origin: true, editedByAdmin: true, characteristics: { where: { origin: "admin" } } },
        });
        if (!product) return { kind: "fail", message: MSG.productNotFound };
        if (product.origin !== "ORGANIZER") {
          return { kind: "fail", message: "Продукт заведён администратором — данных организатора для него нет" };
        }
        if (!catalogProduct(slug)) {
          return {
            kind: "fail",
            message: "Продукта нет в текущих данных организатора — вернуть нечего; оставьте его в архиве",
          };
        }
        const adminKeys = product.characteristics.map((c) => c.key).sort();
        if (!product.editedByAdmin && adminKeys.length === 0) {
          return { kind: "fail", message: "Правок администратора нет — продукт уже совпадает с данными организатора" };
        }
        await tx.productCharacteristic.deleteMany({ where: { productId: product.id, origin: "admin" } });
        await tx.catalogProduct.update({ where: { id: product.id }, data: { editedByAdmin: false } });
        const report = await syncOrganizerData(tx, { only: [slug] });
        await writeLog(tx, admin.userId, [
          {
            entity: "product",
            entityId: product.id,
            field: "revert",
            oldValue: {
              editedByAdmin: product.editedByAdmin,
              characteristics: product.characteristics.map((c) => ({ key: c.key, display: formatCharValue(c) })),
            },
            newValue: { editedByAdmin: false, dataVersion: report.dataVersion },
          },
        ]);
        const chars = adminKeys.length > 0 ? `, снято правок характеристик — ${adminKeys.length}` : "";
        return { kind: "ok", message: `Данные организатора восстановлены${chars}` };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (e) {
    console.error("revertProductAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateCatalog();
  return ok(seq, outcome.message);
}

// ——————————————————————————— Характеристики ———————————————————————————

const QUALIFIERS: ReadonlySet<string> = new Set(["до", "от", "≈"]);
const SCOPES: ReadonlySet<string> = new Set(["per-robot", "per-station", "per-channel", "per-fleet"]);

/** Поля характеристики, которые правит администратор. */
type CharInput = {
  valueNum: number | null;
  valueMin: number | null;
  valueMax: number | null;
  qualifier: string | null;
  valueText: string | null;
  valueList: string[];
  /** Как в форме; пусто — null. Итоговую единицу выбирает действие (см. `resolveUnit`). */
  unit: string | null;
  scope: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  confirmed: boolean;
  note: string | null;
};

/** Наибольшая длина текста характеристики; у перечня — всех пунктов вместе. */
const MAX_CHAR_TEXT = 1000;
const MAX_CHAR_LIST_TEXT = 3000;

/**
 * Разбор строки характеристики по виду ключа словаря (ТЗ §3.3.4):
 * - num и range — типичное значение, границы «от–до», оговорка «до/от/≈», единица, область
 *   значения (на робота, на станцию, на весь парк); текст — необязательное пояснение;
 * - text — текст;
 * - list — перечень, пункт на строку. Разделитель — только перевод строки: внутри пункта
 *   бывает «;» («Wi-Fi 802.11 a/c/n; открытое API»), и «;» как разделитель разрезал бы его.
 * Отрицательные числа допустимы только у температур. Отметка «подтверждено первоисточником»
 * проверяется в действии: там видна прежняя строка (см. `updateCharacteristicAction`).
 */
function parseCharInput(fd: FormData, key: keyof typeof CHARACTERISTIC_KEYS): Parsed<CharInput> {
  const def = CHARACTERISTIC_KEYS[key];
  const label = `«${def.label}»`;
  const numeric = def.kind === "num" || def.kind === "range";

  let valueNum: number | null = null;
  let valueMin: number | null = null;
  let valueMax: number | null = null;
  let qualifier: string | null = null;
  let scope: string | null = null;
  let valueText: string | null = null;
  let valueList: string[] = [];

  const text = optionalText(
    fd,
    "valueText",
    `${label}: ${def.kind === "list" ? "пункты" : "текст"}`,
    def.kind === "list" ? MAX_CHAR_LIST_TEXT : MAX_CHAR_TEXT,
  );
  if (!text.ok) return text;

  if (numeric) {
    const num = optionalNumber(fd, "valueNum", `${label}: значение`);
    if (!num.ok) return num;
    const min = optionalNumber(fd, "valueMin", `${label}: «от»`);
    if (!min.ok) return min;
    const max = optionalNumber(fd, "valueMax", `${label}: «до»`);
    if (!max.ok) return max;
    [valueNum, valueMin, valueMax] = [num.value, min.value, max.value];
    const nums = [valueNum, valueMin, valueMax].filter((n): n is number => n !== null);
    if (!key.startsWith("temp") && nums.some((n) => n < 0)) {
      return { ok: false, message: `${label}: значение не может быть отрицательным` };
    }
    if (valueMin !== null && valueMax !== null && valueMin > valueMax) {
      return { ok: false, message: `${label}: «от» (${fx(valueMin)}) больше «до» (${fx(valueMax)}) — поменяйте границы местами` };
    }
    if (valueNum !== null && ((valueMin !== null && valueNum < valueMin) || (valueMax !== null && valueNum > valueMax))) {
      return { ok: false, message: `${label}: типичное значение ${fx(valueNum)} вне диапазона «от–до» — исправьте значение или границы` };
    }
    const q = field(fd, "qualifier");
    if (q !== "" && !QUALIFIERS.has(q)) return { ok: false, message: `${label}: оговорка — «до», «от» или «≈»` };
    qualifier = q === "" ? null : q;
    if (qualifier !== null && valueNum === null) {
      return { ok: false, message: `${label}: оговорка «${qualifier}» относится к значению — укажите его` };
    }
    const s = field(fd, "scope");
    if (s !== "" && !SCOPES.has(s)) return { ok: false, message: `${label}: выберите, к чему относится значение, из списка` };
    scope = s === "" ? null : s;
    valueText = text.value;
    if (nums.length === 0 && valueText === null) {
      return {
        ok: false,
        message: `${label}: укажите значение — число, диапазон «от–до» или текст. Чтобы вернуть значение организатора, нажмите «Вернуть данные организатора»`,
      };
    }
  } else if (def.kind === "list") {
    valueList = (text.value ?? "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (valueList.length === 0) {
      return { ok: false, message: `${label}: укажите хотя бы один пункт — по одному на строку` };
    }
    if (valueList.length > 30) return { ok: false, message: `${label}: не больше 30 пунктов` };
  } else {
    valueText = text.value;
    if (valueText === null) {
      return {
        ok: false,
        message: `${label}: укажите значение. Чтобы вернуть значение организатора, нажмите «Вернуть данные организатора»`,
      };
    }
  }

  const unitRaw = optionalText(fd, "unit", `${label}: единица`, 40);
  if (!unitRaw.ok) return unitRaw;
  const url = optionalUrl(fd, "sourceUrl");
  if (!url.ok) return url;
  const date = optionalDate(fd, "verifiedAt");
  if (!date.ok) return date;
  const note = optionalText(fd, "note", `${label}: примечание`, MAX_CHAR_TEXT);
  if (!note.ok) return note;

  return {
    ok: true,
    value: {
      valueNum,
      valueMin,
      valueMax,
      qualifier,
      valueText,
      valueList,
      unit: def.kind === "list" ? null : unitRaw.value,
      scope,
      sourceUrl: url.value,
      verifiedAt: date.value,
      confirmed: checked(fd, "confirmed"),
      note: note.value,
    },
  };
}

/**
 * Итоговая единица характеристики. Форма показывает существующей строке её собственную
 * единицу (единица словаря — только подсказка), поэтому у существующей строки единица — ровно
 * та, что в форме, и пустая остаётся пустой. Новой строке пустая единица означает единицу
 * словаря (у производительности её нет: паллет/ч, м²/ч…). У перечня единицы нет — поле не
 * показывается, и единица прежней строки не меняется.
 */
function resolveUnit(key: CharKey, input: CharInput, old: ProductCharacteristic | undefined): string | null {
  const def = CHARACTERISTIC_KEYS[key];
  if (def.kind === "list") return old ? old.unit : null;
  return old ? input.unit : (input.unit ?? def.unit);
}

/** Строка характеристики из БД → CharRow (для пересчёта вынесенных колонок). */
function toCharRow(c: ProductCharacteristic): CharRow {
  return {
    key: c.key,
    valueNum: c.valueNum,
    valueMin: c.valueMin,
    valueMax: c.valueMax,
    qualifier: c.qualifier,
    valueText: c.valueText,
    valueList: c.valueList,
    unit: c.unit,
    scope: c.scope,
    origin: c.origin,
    sourceUrl: c.sourceUrl,
    sourceRef: c.sourceRef,
    verifiedAt: isoDate(c.verifiedAt),
    confirmed: c.confirmed,
    alternatives: c.alternatives,
  };
}

/**
 * Снимок характеристики для журнала: значение по-русски, единица (у текста она в значение
 * не выводится, но правка её — тоже правка) и провенанс.
 */
type CharSnapshot = {
  display: string;
  unit: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  confirmed: boolean;
  note: string | null;
};

/** Поля, из которых складывается снимок: и строка БД, и разобранная форма. */
type SnapshotSource = Pick<
  CharRow,
  | "valueNum"
  | "valueMin"
  | "valueMax"
  | "qualifier"
  | "valueText"
  | "valueList"
  | "unit"
  | "scope"
  | "sourceUrl"
  | "verifiedAt"
  | "confirmed"
> & { note: string | null };

function snapshotOf(c: SnapshotSource): CharSnapshot {
  return {
    display: formatCharValue(c),
    unit: c.unit,
    sourceUrl: c.sourceUrl,
    verifiedAt: c.verifiedAt,
    confirmed: c.confirmed,
    note: c.note,
  };
}

/**
 * Правка характеристики продукта (или добавление недостающей): значение, границы, оговорка,
 * текст, единица, ссылка на источник, дата проверки, «подтверждено», примечание. Строка
 * получает origin 'admin' и sourceType 'admin-edit' — синхронизация её не перезапишет;
 * продукт — editedByAdmin. Затем пересчитываются производные строки «Качества данных»
 * («Подтверждение», «Дата проверки») и вынесенные колонки (цена, производительность, полнота,
 * «требует проверки») — из итогового набора характеристик той же функцией, что у
 * синхронизации. Если значение и ссылка не менялись (правится только дата, отметка или
 * примечание), цитата источника и основание сохраняются; иначе они относились к прежнему
 * значению и очищаются. Другие найденные значения (alternatives) остаются.
 *
 * «Подтверждено первоисточником» у нового или изменённого значения требует ссылки на
 * первоисточник: отметка без источника — это то самое «выдуманное число как подтверждённое».
 * Исключение — значение, которое уже подтверждено по месту в данных организатора (sourceRef)
 * и не меняется: правка даты или примечания не заставляет снимать с него отметку, иначе цена
 * продукта стала бы «неподтверждённой» из-за примечания.
 */
export async function updateCharacteristicAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const slug = slugOf(formData);
  if (!slug) return fail(seq, MSG.productNotFound);
  const key = field(formData, "key");
  if (!isCharKey(key)) return fail(seq, `Характеристика «${key.slice(0, 40)}» не описана в словаре — обновите страницу`);
  const input = parseCharInput(formData, key);
  if (!input.ok) return fail(seq, input.message);
  const group = charGroupOf(key);
  if (group === null) return fail(seq, MSG.badRequest);
  const label = `«${CHARACTERISTIC_KEYS[key].label}»`;

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const product = await tx.catalogProduct.findUnique({
        where: { slug },
        select: { id: true, flags: true, characteristics: { where: { key } } },
      });
      if (!product) return { kind: "fail", message: MSG.productNotFound };
      const old = product.characteristics[0];
      const v: CharInput = { ...input.value, unit: resolveUnit(key, input.value, old) };
      const oldSnap = old ? snapshotOf({ ...toCharRow(old), note: old.note }) : null;
      const newSnap = snapshotOf(v);
      const changedKeys = (Object.keys(newSnap) as (keyof CharSnapshot)[]).filter(
        (k) => !oldSnap || !same(oldSnap[k], newSnap[k]),
      );
      if (oldSnap && changedKeys.length === 0) return { kind: "fail", message: MSG.unchanged };

      const valueSame =
        old !== undefined &&
        same(
          [old.valueNum, old.valueMin, old.valueMax, old.qualifier, old.valueText, old.valueList, old.unit, old.scope, old.sourceUrl],
          [v.valueNum, v.valueMin, v.valueMax, v.qualifier, v.valueText, v.valueList, v.unit, v.scope, v.sourceUrl],
        );
      if (v.confirmed && v.sourceUrl === null) {
        const keepsOrganizerConfirmation = valueSame && old.confirmed && old.sourceRef !== null;
        if (!keepsOrganizerConfirmation) {
          return {
            kind: "fail",
            message: `${label}: отметка «подтверждено первоисточником» у нового или изменённого значения требует ссылки на первоисточник — вставьте ссылку или снимите отметку`,
          };
        }
      }
      const verifiedAt = v.verifiedAt ? new Date(`${v.verifiedAt}T00:00:00Z`) : null;
      const data = {
        valueNum: v.valueNum,
        valueMin: v.valueMin,
        valueMax: v.valueMax,
        qualifier: v.qualifier,
        valueText: v.valueText,
        valueList: v.valueList,
        unit: v.unit,
        scope: v.scope,
        origin: "admin",
        sourceType: "admin-edit",
        sourceUrl: v.sourceUrl,
        verifiedAt,
        confirmed: v.confirmed,
        note: v.note,
        granularity: "field",
        // Цитата, место в источнике и основание описывали прежнее значение.
        ...(valueSame
          ? {}
          : { sourceRef: null, asInSource: null, basis: null, formula: null, confidence: null }),
      };
      if (old) {
        await tx.productCharacteristic.update({ where: { id: old.id }, data });
      } else {
        await tx.productCharacteristic.create({ data: { ...data, productId: product.id, key, group } });
      }

      const all = await refreshDerivedQuality(tx, product.id);
      await tx.catalogProduct.update({
        where: { id: product.id },
        data: { ...promoteColumns(all.map(toCharRow), { flags: product.flags }), editedByAdmin: true },
      });
      const pick = (s: CharSnapshot | null) =>
        s === null ? null : Object.fromEntries(changedKeys.map((k) => [k, s[k]]));
      await writeLog(tx, admin.userId, [
        {
          entity: "characteristic",
          entityId: product.id,
          field: key,
          oldValue: pick(oldSnap),
          newValue: pick(newSnap),
          unit: v.unit,
        },
      ]);
      return { kind: "ok", message: `Записано: ${newSnap.display}` };
    });
  } catch (e) {
    console.error("updateCharacteristicAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateCatalog();
  return ok(seq, outcome.message);
}

// ——————————————————————————— Нормативы ———————————————————————————

/** Границы норматива словами: «0,7–0,85», «не меньше 0», «без ограничений». */
function boundsText(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${fx(min)}–${fx(max)}`;
  if (min !== null) return `не меньше ${fx(min)}`;
  if (max !== null) return `не больше ${fx(max)}`;
  return "без ограничений";
}

function revalidateNorms(): void {
  revalidateAdmin();
  revalidatePath("/methodology/tz");
}

/**
 * Значение норматива. Число прижимается к [min, max] норматива из кода (как в resolveNorms),
 * сообщение называет сохранённое число. autoValue журнала — значение по умолчанию из кода.
 * Взаимные ограничения (сумма весов подбора, порядок границ окупаемости, пороги зарядки)
 * восстанавливает расчёт — страница нормативов об этом предупреждает.
 */
export async function updateNormAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const key = field(formData, "key");
  if (!isNormKey(key)) return fail(seq, `Норматив «${key.slice(0, 40)}» расчёт не использует — обновите страницу`);
  const def = normDef(key);
  const raw = field(formData, "value");
  if (raw === "") return fail(seq, `Введите значение норматива «${def.label}» в единицах «${def.unit}»`);
  const parsed = parseRuNumber(raw);
  if (parsed === null) return fail(seq, `«${raw}» — не число. Введите число, например ${fx(def.value)}`);
  let value = parsed;
  if (def.min !== null && value < def.min) value = def.min;
  if (def.max !== null && value > def.max) value = def.max;
  const clamped = value !== parsed;
  const reason = optionalText(formData, "reason", "Основание правки", 300);
  if (!reason.ok) return fail(seq, reason.message);

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const row = await tx.norm.findUnique({ where: { key } });
      if (!row) return { kind: "fail", message: "Норматива нет в базе — выполните «Обновить каталог» на странице «Данные»" };
      if (row.value === value) {
        return {
          kind: "fail",
          message: clamped
            ? `Значение ${fx(parsed)} вне диапазона ${boundsText(def.min, def.max)}; граница ${fx(value)} уже сохранена`
            : MSG.unchanged,
        };
      }
      await tx.norm.update({ where: { key }, data: { value, editedByAdmin: true, updatedById: admin.userId } });
      await writeLog(tx, admin.userId, [
        {
          entity: "norm",
          entityId: key,
          field: "value",
          autoValue: def.value,
          oldValue: row.value,
          newValue: value,
          unit: def.unit,
          reason: reason.value,
        },
      ]);
      return {
        kind: "ok",
        message: clamped
          ? `Значение ${fx(parsed)} вне допустимого диапазона ${boundsText(def.min, def.max)} — сохранено ${fx(value)}`
          : `Записано: ${fx(value)} ${def.unit}`,
      };
    });
  } catch (e) {
    console.error("updateNormAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateNorms();
  return ok(seq, outcome.message);
}

/**
 * «Сбросить к умолчанию»: значение из кода (NORM_DEFS), editedByAdmin = false — дальше
 * норматив снова обновляется вместе с данными. Сбрасывается одна строка: синхронизация
 * с respectAdminEdits: false сбросила бы все нормативы и параметры сразу.
 */
export async function resetNormAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const key = field(formData, "key");
  if (!isNormKey(key)) return fail(seq, `Норматив «${key.slice(0, 40)}» расчёт не использует — обновите страницу`);
  const def = normDef(key);

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const row = await tx.norm.findUnique({ where: { key } });
      if (!row) return { kind: "fail", message: "Норматива нет в базе — выполните «Обновить каталог» на странице «Данные»" };
      if (row.value === def.value && !row.editedByAdmin) {
        return { kind: "fail", message: "Уже значение по умолчанию" };
      }
      await tx.norm.update({
        where: { key },
        data: { value: def.value, editedByAdmin: false, updatedById: admin.userId },
      });
      await writeLog(tx, admin.userId, [
        {
          entity: "norm",
          entityId: key,
          field: "value",
          autoValue: def.value,
          oldValue: row.value,
          newValue: def.value,
          unit: def.unit,
          reason: "Сброс к значению по умолчанию",
        },
      ]);
      return { kind: "ok", message: `Сброшено к умолчанию: ${fx(def.value)} ${def.unit}` };
    });
  } catch (e) {
    console.error("resetNormAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateNorms();
  return ok(seq, outcome.message);
}

// ——————————————————————————— Параметры объектов ———————————————————————————

const PARAM_KINDS: ReadonlySet<string> = new Set<ParamKind>(["number", "integer", "percent", "enum", "text", "dims"]);

/** Допуск сравнения границ (как в lib/tz/params/schema). */
function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Описание параметра объекта (ParamDefinition, ТЗ §3.2.6 — значения по умолчанию и диапазоны
 * администрируются): базовое значение, минимум, максимум, обязательность, подсказка, пример.
 * Базовое значение приводится по виду параметра той же функцией, что ввод пользователя
 * (coerce), и проверяется по новым границам. Если менялись границы, признак «зафиксировано»
 * (min = max) пересчитывается. Строка получает editedByAdmin — синхронизация её не трогает.
 */
export async function updateParamDefinitionAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (!(formData instanceof FormData)) return fail(seq, MSG.badRequest);
  const id = field(formData, "id");
  if (id === "" || id.length > 64) return fail(seq, MSG.badRequest);
  const hint = optionalText(formData, "hint", "Подсказка", 500);
  if (!hint.ok) return fail(seq, hint.message);
  const example = optionalText(formData, "example", "Пример", 200);
  if (!example.ok) return fail(seq, example.message);
  const reason = optionalText(formData, "reason", "Основание правки", 300);
  if (!reason.ok) return fail(seq, reason.message);
  const required = checked(formData, "required");

  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      const row = await tx.paramDefinition.findUnique({ where: { id }, include: { facilityType: { select: { slug: true } } } });
      if (!row) return { kind: "fail", message: "Параметр не найден — обновите страницу" };
      const kind: ParamKind = PARAM_KINDS.has(row.kind) ? (row.kind as ParamKind) : "text";
      const label = `«${row.label}»`;

      let min: number | null = row.min;
      let max: number | null = row.max;
      const spec: ParamSpec = {
        key: row.key,
        facility: row.facilityType.slug,
        section: row.section,
        label: row.label,
        unit: row.unit,
        kind,
        options: [...row.options],
        base: row.baseNum ?? row.baseText ?? null,
        min,
        max,
        locked: row.locked,
        required: row.required,
        tzMinimum: row.tzMinimum,
        usedBy: [...row.usedBy],
        hint: row.hint,
        example: row.example,
        organizerNote: row.organizerNote,
        origin: "admin",
        sourceRef: row.sourceRef,
        sourceUrl: row.sourceUrl,
        basis: row.basis,
        formula: row.formula,
        order: row.order,
      };
      if (isNumericKind(spec)) {
        const pMin = optionalNumber(formData, "min", `${label}: минимум`);
        if (!pMin.ok) return { kind: "fail", message: pMin.message };
        const pMax = optionalNumber(formData, "max", `${label}: максимум`);
        if (!pMax.ok) return { kind: "fail", message: pMax.message };
        [min, max] = [pMin.value, pMax.value];
        if (min !== null && max !== null && min > max) {
          return { kind: "fail", message: `${label}: минимум ${fx(min)} больше максимума ${fx(max)} — поменяйте границы местами` };
        }
      }
      const bounded: ParamSpec = { ...spec, min, max };
      const coerced = coerce(bounded, field(formData, "base"));
      if (!coerced.ok) return { kind: "fail", message: `Базовое значение: ${coerced.issue.message}` };
      const base = coerced.value;
      if (isOutOfRange(bounded, base)) {
        return {
          kind: "fail",
          message: `${label}: базовое значение ${fx(base as number)} вне диапазона ${boundsText(min, max)} — измените значение или границы`,
        };
      }

      const boundsChanged = !same(min, row.min) || !same(max, row.max);
      const locked = boundsChanged ? min !== null && max !== null && nearlyEqual(min, max) : row.locked;
      const before = {
        base: row.baseNum ?? row.baseText ?? null,
        min: row.min,
        max: row.max,
        required: row.required,
        hint: row.hint,
        example: row.example,
      };
      const after = {
        base,
        min,
        max,
        required,
        hint: hint.value ?? "",
        example: example.value ?? "",
      };
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => !same(before[k], after[k]));
      if (changed.length === 0) return { kind: "fail", message: MSG.unchanged };

      await tx.paramDefinition.update({
        where: { id },
        data: {
          baseNum: typeof base === "number" ? base : null,
          baseText: typeof base === "string" ? base : null,
          min,
          max,
          locked,
          required,
          hint: after.hint,
          example: after.example,
          editedByAdmin: true,
        },
      });
      await writeLog(
        tx,
        admin.userId,
        changed.map((k) => ({
          entity: "paramDefinition",
          entityId: row.id,
          field: k,
          oldValue: before[k],
          newValue: after[k],
          unit: k === "base" || k === "min" || k === "max" ? row.unit : null,
          reason: reason.value,
        })),
      );
      return { kind: "ok", message: `Записано: изменено полей — ${changed.length}` };
    });
  } catch (e) {
    console.error("updateParamDefinitionAction", e);
    return fail(seq, writeError(e));
  }
  if (outcome.kind === "fail") return fail(seq, outcome.message);
  revalidateAdmin();
  return ok(seq, outcome.message);
}

// ——————————————————————————— Обновление каталога ———————————————————————————

/**
 * «Обновить каталог» (ТЗ §3.3.6 — обновление по запросу): синхронизация данных организатора
 * с сохранением правок администратора. Синхронизация сама пишет каждый продукт в своей
 * транзакции (ошибка одного не останавливает остальные), поэтому общей транзакции здесь нет;
 * после неё у продуктов с правками пересчитывается «Качество данных», затем пишется строка
 * журнала с итогом. Отчёт — по-русски, построчно.
 */
export async function refreshCatalogAction(prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const seq = seqOf(prev);
  if (formData !== undefined && !(formData instanceof FormData)) return fail(seq, MSG.badRequest);

  let lines: string[];
  let message: string;
  try {
    const report = await syncOrganizerData(prisma, { respectAdminEdits: true });
    const p = report.products;
    message =
      `Каталог обновлён${changedTotal(report) === 0 ? " — изменений в данных нет" : ""}: ` +
      `создано ${p.created}, обновлено ${p.updated}, пропущено (правки администратора) ${p.skippedAdmin}, ` +
      `в архив ${p.archived}` +
      (p.failed > 0 ? `, не записано ${p.failed}` : "") +
      `; устаревших источников (> ${STALE_SOURCE_DAYS} дней): ${report.staleSources}`;
    lines = formatSyncReport(report);
    // Синхронизация переписывает производные строки «Качества данных» значениями из данных
    // организатора и у продуктов с правками администратора — пересчитать их по итоговому набору.
    const edited = await prisma.catalogProduct.findMany({
      where: { editedByAdmin: true, origin: "ORGANIZER" },
      select: { id: true },
    });
    for (const p of edited) {
      await prisma.$transaction(async (tx) => {
        await refreshDerivedQuality(tx, p.id);
      });
    }
    if (edited.length > 0) {
      lines.push(`«Качество данных» пересчитано по правкам администратора: продуктов ${edited.length}`);
    }
    await writeLog(prisma, admin.userId, [
      {
        entity: "catalog",
        entityId: report.dataVersion,
        field: "refresh",
        newValue: {
          created: p.created,
          updated: p.updated,
          skippedAdmin: p.skippedAdmin,
          archived: p.archived,
          failed: p.failed,
          staleSources: report.staleSources,
          releaseCreated: report.releaseCreated,
        },
      },
    ]);
  } catch (e) {
    console.error("refreshCatalogAction", e);
    return fail(seq, "Обновление каталога не удалось — проверьте подключение к базе и повторите");
  }
  revalidatePath("/", "layout");
  return ok(seq, message, lines);
}
