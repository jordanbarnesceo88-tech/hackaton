// IMPORTANT: @prisma/client does NOT auto-load .env at runtime — only the Prisma CLI
// does. This script runs via `tsx scripts/seed.ts` (not `prisma db seed`), so without
// this line DATABASE_URL is undefined.
import "dotenv/config";
import { PrismaClient, SolutionSource } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { WAREHOUSE_REAL } from "./parse-sources/warehouse-real";
import { seedV2 } from "./seed-v2";

// Prisma 7 requires a driver adapter — `new PrismaClient()` with no adapter throws
// "A driver adapter is required to connect to your database". (Validated pattern.)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

import { INDUSTRIES } from "./seed-data/taxonomy";
import { CATEGORIES } from "./seed-data/categories";
import { APPLICABILITY } from "./seed-data/applicability";
import { VENDOR_SOLUTIONS } from "./seed-data/vendor-solutions";
import { SOLUTION_CLASSES } from "./seed-data/solution-classes";
import { TYPICAL_PARAMS } from "./seed-data/taxonomy";
import { ASSUMPTION_JUSTIFICATIONS } from "../lib/economics/assumption-justifications";
// Значения допущений берутся ОТСЮДА, а не переписываются числами ниже: строка в базе
// перекрывает код на чтении, поэтому вторая копия числа — это способ тихо развести боевую
// с тестами.
import { DEFAULT_ASSUMPTIONS } from "../lib/economics/assumptions";
import type { AssumptionValues } from "../lib/economics/types";


const TYPICAL_EXAMPLE_NAME = "Типовой объект";

async function main() {
  let industryCount = 0;
  let facilityTypeCount = 0;
  let categoryCount = 0;
  let solutionCount = 0;

  // Здесь остаётся только то, чего в модели НЕТ: подпись, единица, порядок. Ни значения, ни
  // обоснования — у обоих единственный источник правды в коде, и обе копии уже разъезжались:
  //
  //  · `value` дублировался числом (`laborCostPerHourUsd: 6.7` стояло и здесь, и в
  //    DEFAULT_ASSUMPTIONS). Строка в базе ПЕРЕКРЫВАЕТ код — assumptionsToValues читает базу и
  //    подставляет её значение поверх умолчания, — поэтому разъехавшаяся копия означала бы, что
  //    боевая считает по числу, которого нет ни в одном тесте. Теперь значение берётся из
  //    DEFAULT_ASSUMPTIONS, и разъехаться нечему.
  //  · `description` — из ASSUMPTION_JUSTIFICATIONS, он же выводится на экран.
  //
  // Тип Record<keyof AssumptionValues, …>: допущение, добавленное в модель и забытое здесь —
  // или оставленное здесь после удаления из модели — НЕ КОМПИЛИРУЕТСЯ. До этого ключ приводился
  // к типу через `as`, и лишний ключ молча записывал в базу пустое обоснование.
  const ASSUMPTION_META: Record<
    keyof AssumptionValues,
    { label: string; unit: string; order: number }
  > = {
    laborCostPerHourUsd: { label: "Стоимость труда (час)", unit: "USD/час", order: 1 },
    hoursPerYear: { label: "Рабочих часов в году (на сотрудника)", unit: "часов", order: 2 },
    workingDaysPerYear: { label: "Рабочих дней в году", unit: "дней", order: 3 },
    operatingHoursPerDay: { label: "Часов работы объекта в сутки", unit: "часов", order: 4 },
    installPctOfCapex: { label: "Монтаж/интеграция (доля от CAPEX)", unit: "доля", order: 5 },
    laborReplacementPct: { label: "Замещение труда роботами", unit: "доля", order: 6 },
    residualSupervisionPct: { label: "Остаточный надзор персоналом", unit: "доля", order: 7 },
    opsPerWorkerPerYear: { label: "Операций на сотрудника в год", unit: "операций", order: 8 },
    areaPerCleanerPerYear: { label: "Площадь на уборщика в год", unit: "м²/год", order: 9 },
    cleaningsPerDay: { label: "Уборок площади в сутки", unit: "раз", order: 10 },
    turnoverPerDay: { label: "Оборотов в сутки (для stock-решений)", unit: "раз", order: 11 },
    roiHorizonYears: { label: "Горизонт расчёта ROI", unit: "лет", order: 12 },
    discountRate: { label: "Ставка дисконтирования", unit: "доля", order: 13 },
    assetLifeYears: { label: "Срок службы техники", unit: "лет", order: 14 },
    usdToRub: { label: "Курс USD→RUB", unit: "₽/$", order: 15 },
    energyCostFactor: { label: "Множитель энергозатрат (регион)", unit: "коэф.", order: 16 },
  };
  const assumptions = (Object.keys(ASSUMPTION_META) as (keyof AssumptionValues)[]).map((key) => ({
    key,
    ...ASSUMPTION_META[key],
    value: DEFAULT_ASSUMPTIONS[key],
  }));

  // Значение — единственное поле допущения, которое оператор мог осмысленно поправить руками в
  // боевой (UI для этого нет, но SQL есть, и курс доллара живёт именно так). Сев его
  // перезаписывает: в этом и смысл выката — довезти новую ставку труда. Но у оператора должен
  // быть способ сказать «подписи и обоснования обнови, цифры не трогай», иначе единственная
  // альтернатива — не запускать сев вовсе, а без него не доедут обоснования.
  const keepValues = process.env.SEED_KEEP_ASSUMPTION_VALUES === "1";
  // `description` обязан быть в `update`, а не только в `create`: без него сев никогда не
  // обновлял обоснования на уже существующих строках, и всё написанное выше не доехало бы ни
  // до одной живой базы — ровно та ошибка, из-за которой пустыми они и оставались.
  for (const asmp of assumptions) {
    const j = ASSUMPTION_JUSTIFICATIONS[asmp.key];
    const description = `[${j.basis}] ${j.text}`;
    const existing = await prisma.assumption.findUnique({
      where: { key: asmp.key },
      select: { value: true },
    });
    if (existing && existing.value !== asmp.value) {
      console.log(
        keepValues
          ? `  допущение ${asmp.key}: ${existing.value} в базе СОХРАНЕНО (в коде ${asmp.value}, SEED_KEEP_ASSUMPTION_VALUES=1)`
          : `  допущение ${asmp.key}: ${existing.value} → ${asmp.value}`
      );
    }
    await prisma.assumption.upsert({
      where: { key: asmp.key },
      update: {
        label: asmp.label,
        unit: asmp.unit,
        order: asmp.order,
        description,
        ...(keepValues ? {} : { value: asmp.value }),
      },
      create: { ...asmp, description },
    });
  }

  // Допущения, которые есть в базе, но которых нет в модели. Сев их НЕ удаляет: строка
  // безвредна (assumptionsToValues обходит ключи модели, а не базы, и лишнюю не прочитает), а
  // удаление — необратимо и не обязано быть решением скрипта. Но молчать о ней нельзя: она
  // выглядит как действующее допущение для всякого, кто откроет таблицу.
  {
    const extra = await prisma.assumption.findMany({
      where: { key: { notIn: assumptions.map((a) => a.key) } },
      select: { key: true, value: true },
    });
    for (const e of extra) {
      console.warn(
        `  в базе допущение "${e.key}" = ${e.value}, которого нет в модели: движок его не читает, ` +
          `сев не трогает. Удалять — вручную и осознанно.`
      );
    }
  }

  for (const industrySeed of INDUSTRIES) {
    const industry = await prisma.industry.upsert({
      where: { slug: industrySeed.slug },
      update: { name: industrySeed.name },
      create: { slug: industrySeed.slug, name: industrySeed.name },
    });
    industryCount++;

    for (const ft of industrySeed.facilityTypes) {
      await prisma.facilityType.upsert({
        where: { slug: ft.slug },
        update: { name: ft.name, isGeneric: ft.isGeneric, industryId: industry.id },
        create: { slug: ft.slug, name: ft.name, isGeneric: ft.isGeneric, industryId: industry.id },
      });
      facilityTypeCount++;
    }
  }

  // Типовые параметры объекта: шаг ввода стартует с них, а не с пустых полей.
  for (const [slug, tp] of Object.entries(TYPICAL_PARAMS)) {
    const ft = await prisma.facilityType.findUnique({ where: { slug } });
    if (!ft) throw new Error(`Нет типа объекта ${slug} для типовых параметров`);
    // На (facilityTypeId, name) нет уникального индекса, поэтому upsert здесь невозможен, а
    // findFirst+update идемпотентен только пока строка одна. Если база пережила сев, который
    // делал безусловный `create`, их две — и findFirst обновлял бы одну, а getTypicalParams
    // (`take: 1` без orderBy) с равным правом читал бы вторую, с параметрами позапрошлого
    // выката. Поэтому обновляются ВСЕ, а о дубле говорится вслух: удалять чужие строки сев не
    // должен, но и делать вид, что их нет, нельзя.
    const existing = await prisma.facilityExample.findMany({
      where: { facilityTypeId: ft.id, name: TYPICAL_EXAMPLE_NAME },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (existing.length > 1) {
      console.warn(
        `  у типа объекта ${slug} ${existing.length} строк «${TYPICAL_EXAMPLE_NAME}»: обновлены все, ` +
          `но лишние стоит удалить вручную — какую из них прочитает визард, не определено.`
      );
    }
    if (existing.length > 0) {
      await prisma.facilityExample.updateMany({
        where: { id: { in: existing.map((e) => e.id) } },
        data: { params: tp },
      });
    } else {
      await prisma.facilityExample.create({
        data: { name: TYPICAL_EXAMPLE_NAME, facilityTypeId: ft.id, params: tp },
      });
    }
  }

  // Категории глобальны — заводятся один раз, независимо от того, скольким типам объектов
  // они служат.
  for (const c of CATEGORIES) {
    await prisma.solutionCategory.upsert({
      where: { slug: c.slug },
      // Норматив прокидывается через `?? null`, а не пропуском: пропуск в update оставил бы в
      // базе старое значение после того, как его убрали из источника, и снятый норматив
      // продолжил бы предзаполнять занятость цифрой, которой больше нигде нет.
      update: {
        name: c.name,
        description: c.description,
        workloadStream: c.workloadStream,
        taskLabel: c.taskLabel,
        workerOutputPerYear: c.workerOutputPerYear ?? null,
        workerOutputSourceUrl: c.workerOutputSourceUrl ?? null,
      },
      create: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        workloadStream: c.workloadStream,
        taskLabel: c.taskLabel,
        workerOutputPerYear: c.workerOutputPerYear ?? null,
        workerOutputSourceUrl: c.workerOutputSourceUrl ?? null,
      },
    });
    categoryCount++;
  }

  for (const link of APPLICABILITY) {
    const ft = await prisma.facilityType.findUnique({ where: { slug: link.facilityType } });
    if (!ft) throw new Error(`Нет типа объекта ${link.facilityType} для связи применимости`);
    for (const [i, categorySlug] of link.categories.entries()) {
      const category = await prisma.solutionCategory.findUnique({ where: { slug: categorySlug } });
      if (!category) throw new Error(`Нет категории ${categorySlug} для ${link.facilityType}`);
      await prisma.facilityTypeCategory.upsert({
        where: { facilityTypeId_categoryId: { facilityTypeId: ft.id, categoryId: category.id } },
        update: { order: i },
        create: { facilityTypeId: ft.id, categoryId: category.id, order: i },
      });
    }
  }

  for (const sol of VENDOR_SOLUTIONS) {
    const category = await prisma.solutionCategory.findUnique({ where: { slug: sol.categorySlug } });
    if (!category) throw new Error(`Нет категории ${sol.categorySlug} для решения ${sol.name}`);
    const data = {
      // name и solutionCategoryId — в update, а не только в create: upsert находит строку по
      // slug'у, но если сам не перепишет ей имя и категорию, переименование или переезд в
      // источнике до строки не долетят — она останется под старым именем/в старой категории.
      // А чистка ниже строит список «живых» имён из ТЕКУЩИХ источников: только что
      // обновлённую (по всем остальным полям) строку со старым именем она сочтёт пропавшей
      // и удалит — то самое решение, которое slug как раз должен был сохранить.
      name: sol.name,
      solutionCategoryId: category.id,
      vendor: sol.vendor,
      priceUsd: sol.priceUsd,
      sourceUrl: sol.sourceUrl,
      lastVerified: new Date(sol.lastVerified),
      // Цена берётся у дистрибьютора и потому всегда оценка: производители прайс не публикуют.
      priceEstimated: true,
      priceBasis: `цена по странице дистрибьютора, проверена ${sol.lastVerified}`,
      capacityPerUnit: sol.capacityPerUnit,
      capacityUnit: sol.capacityUnit,
      capacityBasis: sol.capacityBasis,
      maintenanceUsdYear: sol.maintenanceUsdYear,
      energyUsdYear: sol.energyUsdYear,
      licensingUsdYear: sol.licensingUsdYear,
      specs: sol.specs,
      source: SolutionSource.SEED,
    };
    // Ключ — slug, а не пара (категория, имя): переименование строки в источнике должно
    // обновлять существующую запись, а не заводить вторую (М-2). В `update` slug не входит
    // намеренно — он и есть ключ, переписывать его собой незачем.
    await prisma.solution.upsert({
      where: { slug: sol.slug },
      update: data,
      create: { ...data, slug: sol.slug },
    });
    solutionCount++;
  }

  // Классы решений: диапазоны вместо точных цифр, середина уходит в поля, которые читает
  // движок, — та же конвенция, что уже применяется к CAPEX «по середине диапазона».
  for (const c of SOLUTION_CLASSES) {
    const category = await prisma.solutionCategory.findUnique({ where: { slug: c.categorySlug } });
    if (!category) throw new Error(`Нет категории ${c.categorySlug} для класса ${c.slug}`);
    const data = {
      // name/solutionCategoryId в update по той же причине, что у вендорского upsert выше:
      // без них переименование или переезд класса не долетают до строки, а чистка ниже примет
      // её (уже обновлённую по остальным полям, но со старым именем) за пропавшую и удалит.
      name: c.name,
      solutionCategoryId: category.id,
      vendor: "—",
      isClass: true,
      priceEstimated: true,
      priceLowUsd: c.priceLowUsd,
      priceHighUsd: c.priceHighUsd,
      priceUsd: (c.priceLowUsd + c.priceHighUsd) / 2,
      priceBasis: "середина диапазона по открытым источникам",
      capacityLow: c.capacityLow,
      capacityHigh: c.capacityHigh,
      capacityPerUnit: (c.capacityLow + c.capacityHigh) / 2,
      capacityUnit: c.capacityUnit,
      capacityBasis: c.capacityBasis,
      maintenanceUsdYear: c.maintenanceUsdYear,
      energyUsdYear: c.energyUsdYear,
      licensingUsdYear: c.licensingUsdYear,
      specs: { capacitySourceUrl: c.capacitySourceUrl },
      source: SolutionSource.SEED,
      sourceUrl: c.sourceUrl,
      lastVerified: new Date(c.lastVerified),
    };
    await prisma.solution.upsert({
      where: { slug: c.slug },
      update: data,
      create: { ...data, slug: c.slug },
    });
    solutionCount++;
  }

  // Real, cited warehouse products (source: PARSED) — replaces the demo warehouse rows.
  const warehouse = await prisma.facilityType.findUnique({ where: { slug: "warehouse" } });
  if (warehouse) {
    for (const s of WAREHOUSE_REAL) {
      const category = await prisma.solutionCategory.findUnique({
        where: { slug: s.categorySlug },
      });
      // Бросок, а не `continue`. Пропуск молча оставлял складскую строку непосеянной, и
      // единственным следом была итоговая проверка внизу — «сев объявил решения, которых после
      // него нет в базе», с догадкой «скорее всего, их удалила чистка». Причина названа здесь.
      if (!category) {
        throw new Error(`Нет категории ${s.categorySlug} для складского решения ${s.name}`);
      }
      const data = {
        // name/solutionCategoryId в update по той же причине, что у вендорского upsert выше:
        // без них переименование или переезд складской строки не долетают до записи, а
        // чистка ниже примет её (уже обновлённую по остальным полям, но со старым именем)
        // за пропавшую и удалит.
        name: s.name,
        solutionCategoryId: category.id,
        vendor: s.vendor, priceUsd: s.priceUsd, priceEstimated: s.priceEstimated,
        priceLowUsd: s.priceLowUsd, priceHighUsd: s.priceHighUsd, priceBasis: s.priceBasis,
        capacityPerUnit: s.capacityPerUnit, capacityUnit: s.capacityUnit,
        capacityBasis: s.capacityBasis, maintenanceUsdYear: s.maintenanceUsdYear,
        energyUsdYear: s.energyUsdYear, licensingUsdYear: s.licensingUsdYear,
        specs: s.specs, source: SolutionSource.PARSED,
        sourceUrl: s.sourceUrl, lastVerified: new Date(s.lastVerified),
      };
      await prisma.solution.upsert({
        where: { slug: s.slug },
        update: data,
        create: { slug: s.slug, ...data },
      });
      solutionCount++;
    }

    // Складская чистка удалена: общая, ниже, уже удаляет любую строку, которой нет ни в одном
    // источнике сева, и делает это по slug'у, а не по вертикали. Складская же отбирала строки
    // «применимые к складу», и после появления сквозных категорий начала съедать законные
    // вендорские решения: Gausium лежит в категории уборки, применимой в том числе к складу,
    // в складской список не входит — и исчезал из базы на каждом севе.
  }

  // ЧИСТКА. Строки, которых больше нет ни в одном источнике сева, удаляются — иначе upsert их
  // сохраняет вечно, и удалённые из кода заглушки продолжают жить в базе. Решение, на которое
  // ссылается чей-то сохранённый расчёт, не трогается: FK стоит на Restrict, и попытка
  // обернулась бы падением всего сева.
  //
  // Стоит ПОСЛЕ всех записей, а не между ними, и это не косметика. Чистка — единственное
  // необратимое действие сева, а сев не в транзакции: падение раньше неё оставляет базу
  // недосеянной, но целой, и повторный запуск чинит всё. Падение ПОСЛЕ неё уже ничего не
  // вернёт. Порядок «сначала записать всё, потом удалить лишнее» делает единственный опасный
  // шаг последним. Списку `seeded` перестановка безразлична: он строится из источников, а не
  // из базы.
  //
  // Список «живых» — это SLUG'и источников, а не имена (см. docs/DEPLOY.md, приложение B.3,
  // п. 3). По именам чистка была слепа ровно к той строке, ради которой slug и заводился:
  // решение, переехавшее в источнике в другую категорию, upsert по slug'у не находил (у
  // строки в базе после бэкфилла стоял `legacy-<id>`), заводил рядом вторую — а чистка
  // спрашивала, есть ли ИМЯ среди живых, находила его у новой строки и оставляла старую жить.
  // Два одинаковых товара в каталоге, один переоценивается, второй заморожен навсегда, и ни
  // одна строка лога об этом не говорила. По slug'у осиротевшая строка попадает в список
  // сразу — с ней поступают как со всяким выпавшим из источников: печатают и удаляют.
  {
    const seeded = new Set([
      ...VENDOR_SOLUTIONS.map((s) => s.slug),
      ...SOLUTION_CLASSES.map((c) => c.slug),
      ...WAREHOUSE_REAL.map((s) => s.slug),
    ]);
    const stale = await prisma.solution.findMany({
      where: {
        source: { in: [SolutionSource.SEED, SolutionSource.PARSED] },
        slug: { notIn: [...seeded] },
      },
      select: {
        id: true, name: true, slug: true, vendor: true, source: true,
        solutionCategory: { select: { slug: true } },
        _count: { select: { savedAnalyses: true } },
      },
      orderBy: { name: "asc" },
    });
    const deletable = stale.filter((s) => s._count.savedAnalyses === 0);

    // Что именно исчезнет — ДО того, как исчезло. Раньше печатался только счётчик постфактум,
    // и на базе, которую сев видит впервые, «удалено 14» не позволяет узнать, что это было.
    for (const s of deletable) {
      // slug печатается наравне с именем: по имени осиротевшую строку от каталожной не
      // отличить, а `legacy-…` в этой позиции сразу говорит, что бэкфилл миграции её не опознал.
      console.log(
        `  УДАЛЯЕТСЯ [${s.source}] «${s.name}» (${s.vendor}) из ${s.solutionCategory.slug}, slug ${s.slug}`
      );
    }

    // Предохранитель. На боевой, которую этот сев видит впервые, чистка может встретить весь
    // старый каталог сразу — и «то, чего нет в источниках» перестаёт означать «заглушка,
    // удалённая из кода». Порог не запрещает удаление, он требует, чтобы его назвали вслух:
    // список выше уже напечатан, решение принимает человек. Бросок здесь безопасен — до него
    // сев уже дописал всё остальное и ничего не удалил.
    const limit = Number(process.env.SEED_PRUNE_LIMIT ?? 10);
    if (process.env.SEED_PRUNE === "off") {
      console.warn(`  чистка ПРОПУЩЕНА (SEED_PRUNE=off): ${deletable.length} строк оставлены как есть.`);
    } else if (deletable.length > limit && process.env.SEED_PRUNE !== "force") {
      throw new Error(
        `чистка хочет удалить ${deletable.length} решений — больше порога ${limit}. Список выше. ` +
          `Ни одна строка НЕ удалена, остальное посеяно. Сверьте список и повторите с ` +
          `SEED_PRUNE=force (удалить) или SEED_PRUNE=off (оставить); порог меняется ` +
          `SEED_PRUNE_LIMIT.`
      );
    } else if (deletable.length > 0) {
      await prisma.solution.deleteMany({ where: { id: { in: deletable.map((s) => s.id) } } });
      console.log(`  удалено строк, которых больше нет в источниках: ${deletable.length}`);
    }

    for (const s of stale.filter((x) => x._count.savedAnalyses > 0)) {
      console.warn(
        `  оставлено «${s.name}» (${s.vendor}, slug ${s.slug}): на него ссылаются сохранённые расчёты ` +
          `(${s._count.savedAnalyses}). Строка больше не обновляется ни одним источником — ` +
          `её цена и производительность заморожены навсегда.`
      );
    }

    // Строки организатора чистка не трогает намеренно (фильтр по source), но молчать о них
    // нельзя: их никто не обновляет, и на экране они стоят рядом с посеянными.
    const organizer = await prisma.solution.findMany({
      where: { source: SolutionSource.ORGANIZER },
      select: { name: true, vendor: true, solutionCategory: { select: { slug: true } } },
    });
    if (organizer.length > 0) {
      console.log(`  строк ORGANIZER (чистка их не трогает): ${organizer.length}`);
      for (const s of organizer) {
        console.log(`    · «${s.name}» (${s.vendor}) в ${s.solutionCategory.slug}`);
      }
    }

    // После М-2 upsert находит строку по slug'у и сам переписывает ей name и
    // solutionCategoryId (см. комментарий у вендорского upsert выше), а чистка выше сверяет
    // slug'и — поэтому переименование и переезд между категориями теперь ОБНОВЛЯЮТ строку, а
    // осиротевшая строка со старым slug'ом попадает в список чистки и удаляется. Этот блок
    // сравнивает по ИМЕНИ намеренно: до него доходит только то, что чистка удалить не может, и
    // каждый такой случай лечится РУКАМИ, а не повторным севом:
    //   · строка source=ORGANIZER — её сев не трогает по построению (фильтр по source);
    //   · строка, которую спасли сохранённые расчёты: чистка её не удаляет (FK Restrict), и
    //     она остаётся в каталоге рядом с канонической, замороженная навсегда;
    //   · прогон с SEED_PRUNE=off — чистка пропущена целиком.
    // Имя здесь — единственный доступный признак: у такой строки slug ДРУГОЙ (обычно
    // `legacy-<id>` от бэкфилла миграции), и по slug'у она с канонической не сопоставляется
    // никак. Сверка по имени работает ровно пока имена в источниках не повторяются — это
    // закреплено тестом в scripts/seed-data/seed-data.test.ts.
    {
      const expectedCategory = new Map<string, string>([
        ...VENDOR_SOLUTIONS.map((s) => [s.name, s.categorySlug] as const),
        ...SOLUTION_CLASSES.map((c) => [c.name, c.categorySlug] as const),
        ...WAREHOUSE_REAL.map((s) => [s.name, s.categorySlug] as const),
      ]);
      const named = await prisma.solution.findMany({
        where: { name: { in: [...expectedCategory.keys()] } },
        select: {
          name: true, slug: true, vendor: true, priceUsd: true, source: true,
          solutionCategory: { select: { slug: true } },
          _count: { select: { savedAnalyses: true } },
        },
      });
      for (const s of named) {
        const want = expectedCategory.get(s.name);
        if (want && s.solutionCategory.slug !== want) {
          // Причина называется здесь же: без неё оператор не знает, повторить ли сев (не
          // поможет НИ В ОДНОМ из этих случаев) или идти сливать строки руками.
          const why =
            s.source === SolutionSource.ORGANIZER
              ? "это строка организатора, чистка её не трогает"
              : s._count.savedAnalyses > 0
                ? `на неё ссылаются сохранённые расчёты (${s._count.savedAnalyses}), чистка такие не удаляет`
                : "чистка её не удалила — значит сев бежал с SEED_PRUNE=off";
          console.warn(
            `  ДУБЛИКАТ: «${s.name}» есть и в ${s.solutionCategory.slug} (slug ${s.slug}, цена ` +
              `${s.priceUsd}, больше не обновляется), и в ${want} (посеяна сейчас). Осталась ` +
              `потому, что ${why}. Повторный сев этого не исправит: слить руками — перенести ` +
              `SavedAnalysis.solutionId на выжившую строку и удалить проигравшую ` +
              `(docs/DEPLOY.md, приложение B.4).`
          );
        }
      }
    }
  }

  // Названия-задачи: DEFAULT '' в миграции существует ради существующих строк, а не ради
  // авторов данных. Тест в seed-data проверяет ИСТОЧНИК, а не базу, и пустую строку в базе он
  // не увидит — а экран сравнения задач покажет безымянную строку.
  //
  // Проверка ограничена категориями, которые сев ЗАВОДИТ. Раньше она сканировала таблицу
  // целиком и на боевой была бы гарантированным падением: категорию, исчезнувшую из источника,
  // сев не удаляет, миграция дала ей taskLabel = '' — и сев ронял сам себя из-за строки, за
  // которую не отвечает. Причём ронял ПОСЛЕ записей: деплой красный, база изменена, повторный
  // запуск падает так же и навсегда. За свои строки он отвечает и падает; о чужих сообщает.
  {
    const seededSlugs = CATEGORIES.map((c) => c.slug);
    const blank = await prisma.solutionCategory.findMany({
      where: { taskLabel: "", slug: { in: seededSlugs } },
      select: { slug: true },
    });
    if (blank.length > 0) {
      throw new Error(
        `категории без названия-задачи после сева: ${blank.map((c) => c.slug).join(", ")}`
      );
    }
    const foreign = await prisma.solutionCategory.findMany({
      where: { slug: { notIn: seededSlugs } },
      select: { slug: true, taskLabel: true, _count: { select: { solutions: true, facilityTypes: true } } },
    });
    for (const c of foreign) {
      console.warn(
        `  категория «${c.slug}» есть в базе, но её нет в источнике: решений ${c._count.solutions}, ` +
          `привязок к объектам ${c._count.facilityTypes}, название-задача ` +
          `${c.taskLabel ? `«${c.taskLabel}»` : "ПУСТОЕ (экран покажет безымянную строку)"}. ` +
          `Сев её не заводит и не удаляет — решение за оператором.`
      );
    }
  }

  // Норматив без источника в базе означал бы, что предзаполнение занятости опирается на
  // цифру, происхождение которой некому показать. Правило двух концов, проверенное на базе,
  // а не только на источнике. Ограничено теми же строками и по той же причине.
  {
    const orphan = await prisma.solutionCategory.findMany({
      where: {
        workerOutputPerYear: { not: null },
        workerOutputSourceUrl: null,
        slug: { in: CATEGORIES.map((c) => c.slug) },
      },
      select: { slug: true },
    });
    if (orphan.length > 0) {
      throw new Error(`норматив выработки без источника: ${orphan.map((c) => c.slug).join(", ")}`);
    }
  }

  // Связи применимости, которых больше нет в APPLICABILITY. Сев их не удаляет: связь — это не
  // только его данные (её мог поставить организатор), а удаление молча убирает задачу с экрана
  // объекта. Но лишняя связь — это паллетайзер в больничной палате, ровно то, ради чего
  // FacilityTypeCategory заведена явной таблицей; молчать о ней нельзя.
  {
    const declared = new Set(
      APPLICABILITY.flatMap((a) => a.categories.map((c) => `${a.facilityType}\u0000${c}`))
    );
    const links = await prisma.facilityTypeCategory.findMany({
      select: { facilityType: { select: { slug: true } }, category: { select: { slug: true } } },
    });
    const extra = links.filter((l) => !declared.has(`${l.facilityType.slug}\u0000${l.category.slug}`));
    if (extra.length > 0) {
      console.warn(
        `  связей применимости в базе, которых нет в источнике: ${extra.length}. Сев их не ` +
          `удаляет; каждая — задача, показанная на объекте, к которому источник её не относит:`
      );
      for (const l of extra) console.warn(`    · ${l.facilityType.slug} → ${l.category.slug}`);
    }
  }

  // Проверка, что сев действительно оставил в базе то, что в нём объявлено. Появилась после
  // того, как складская чистка тихо удаляла Gausium на каждом севе: сев печатал успех, строка
  // из базы исчезала, и заметно это было только при ручном запросе. Дешевле, чем ещё один
  // такой раунд.
  //
  // Сверяется SLUG — тот же ключ, которым сев писал (docs/DEPLOY.md, приложение B.3, п. 4).
  // Пара (категория, имя) для этого не годится в обе стороны: переименование в источнике она
  // объявляет пропажей строки, которую upsert только что успешно обновил, а сверку по одному
  // имени закрывала бы собой чужая строка из другой категории — ровно тот дубликат, о котором
  // предупреждает блок выше. Slug'ом проверяется именно то, что сев объявил и записал.
  {
    const expected = [
      ...VENDOR_SOLUTIONS.map((s) => s.slug),
      ...SOLUTION_CLASSES.map((c) => c.slug),
      ...WAREHOUSE_REAL.map((s) => s.slug),
    ];
    const present = new Set(
      (await prisma.solution.findMany({ select: { slug: true } })).map((s) => s.slug)
    );
    const missing = expected.filter((key) => !present.has(key));
    if (missing.length > 0) {
      throw new Error(
        `сев объявил решения, которых после него нет в базе (slug'и): ${missing.join(", ")}. ` +
          `Скорее всего, их удалила одна из чисток выше.`
      );
    }
  }

  await seedV2(prisma);

  console.log(
    `Seeded ${industryCount} industries, ${facilityTypeCount} facility types, ${categoryCount} solution categories, ${solutionCount} solutions, ${assumptions.length} assumptions.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
