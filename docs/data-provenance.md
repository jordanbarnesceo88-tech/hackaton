# Data Provenance — Real Warehouse Products

> **Researched starting point — VERIFY every figure before a live client demo.** Specs and
> especially prices drift; vendor datasheets list optimistic best-case numbers; industrial-robot
> list prices are **not published**, so every price here is a **third-party estimate**, never an
> official quote. These rows are seeded as `source: PARSED` with the `sourceUrl` below and shown
> in-app with an "оценка" marker. Curated 2026-08-30 (`lastVerified`). Airport / medical / other
> verticals remain demo (`SEED`) pending organizer data.

## How each field was derived

- **Throughput (`capacityPerUnit`)** — taken only from a live public page (the product's
  `sourceUrl`). Goods-to-person AS/RS (Exotec, AutoStore) is modelled **per pick station / port**
  (a coherent, comparable grain); the ACR (HAI) is **per robot**.
- **Price** — a cited third-party **estimate range** (`priceLowUsd`–`priceHighUsd`);
  `priceUsd` = the rounded **midpoint** (the figure the ROI engine computes with). `priceEstimated`
  is `true` and `priceBasis` names the estimate source. **No price is an official vendor quote.**
- **Energy** — estimated from a cited/representative power draw × operating hours × an RF
  electricity tariff (order-of-magnitude only).
- **Maintenance** — documented rule of thumb ≈ **8% of CAPEX/yr** (Robotomated's 8–12% band for
  this class). **Licensing/software** — small annual estimate.

## Products

### Hai Robotics — HaiPick A42T  (category: `amr`, autonomous case-handling robot)
| Figure | Value | Source / basis |
|---|---|---|
| Throughput | 63 totes/hr per robot (A42T-E2) | hairobotics.com (product page) |
| Payload | 50 kg | hairobotics.com |
| Storage height | 6 m | hairobotics.com |
| **Price (estimate)** | **$40,000–$80,000 / robot** (mid $60k) | GoASRS analysis (3rd-party estimate) — goasrs.com/hai-robotics-acr |
| Maintenance/yr | ~$4,800 (≈8% CAPEX) | rule of thumb (Robotomated 8–12%) |
| Energy/yr | ~$350 | ~1 kW × ~4000 h × ~$0.08/kWh (estimate) |
| Licensing/yr | ~$3,000 | HAIQ software (estimate) |
| `sourceUrl` | https://www.hairobotics.com/robots/haipick-a42t | |

### Exotec — Skypod (station)  (category: `asrs`, goods-to-person AS/RS, per station)
| Figure | Value | Source / basis |
|---|---|---|
| Throughput | ~500 picks/hr per station (cited range 400–600) | exotec.com (Skypod AS/RS page) |
| Robot height | ~12 m (39 ft) | exotec.com |
| **Price (estimate)** | **$100,000–$500,000 / station** (mid $300k); full system $2–10M | Robotomated cost analysis (3rd-party estimate) |
| Maintenance/yr | ~$24,000 (≈8% CAPEX) | rule of thumb |
| Energy/yr | ~$2,000 | station + robot pool (estimate) |
| Licensing/yr | ~$6,000 | software/support (estimate) |
| `sourceUrl` | https://www.exotec.com/skypod-automated-storage-retrieval-system/ | |

### AutoStore — (port)  (category: `asrs`, cube-storage AS/RS, per port)
| Figure | Value | Source / basis |
|---|---|---|
| Throughput | ~650 bin presentations/hr per port (RelayPort) | autostoresystem.com (high-throughput page) |
| Per-robot throughput | ~30 bins/hr; robot ~0.1 kW | autostoresystem.com |
| **Price (estimate)** | **$100,000–$500,000 / station** (mid $300k, GTP class); full system $3–6M | Robotomated (per-station) / Kardex (full system $3–6M) — both 3rd-party estimates |
| Maintenance/yr | ~$24,000 (≈8% CAPEX) | rule of thumb |
| Energy/yr | ~$1,500 | ~0.1 kW/robot × pool (estimate) |
| Licensing/yr | ~$6,000 | software (estimate) |
| `sourceUrl` | https://www.autostoresystem.com/benefits/high-throughput | |

## Классы решений (`isClass = true`)

> Заведены 2026-09-07 вместе с расширением таксономии до 12 отраслей и 47 типов объектов.
> **Класс — это не продукт.** Он не имеет вендора (`vendor` = «—»), помечен `priceEstimated`,
> и в интерфейсе называется классом. Существует затем, чтобы новая ветка справочника вела к
> расчёту, а не к пустому экрану, — и чтобы при этом не пришлось выдумывать вендорские спеки,
> что прямо запрещено этим документом.

**Правило, по которому класс попадает сюда, и по которому пять кандидатов не попали.** Класс
заводится, только если **оба конца обоих диапазонов** — цены и производительности — взяты из
опубликованного источника. Изначально планировалось двенадцать классов; осталось семь.
Открытые источники охотно публикуют цены и почти никогда — производительность на единицу, а
движку нужна именно она. AGV-тягачи, роботы дезинфекции, AS/RS как класс и ещё два кандидата
имеют найденную цену и ненайденную производительность; недостающий конец **не достраивается
«по смыслу»**, поэтому классов нет. Ветки, которые они бы закрыли, закрыты другими классами.

Цена и производительность — разные утверждения из разных источников, поэтому у класса **две**
ссылки, и `npm run check:sources` следит за обеими отдельно (17 цитат вместо прежних 3).

| Класс | Цена, $ | Производительность | Источник цены | Источник производительности |
|---|---|---|---|---|
| AMR: транспортировка и подбор | 25 000–150 000 | 70–120 отборов/час | meshautomationinc.com | smartloadinghub.com |
| Робот-паллетайзер | 50 000–250 000 | 900–7 800 коробок/час | standardbots.com | blueskyrobotics.ai |
| Сортировочный робот | 25 000–100 000 | 1 200–6 000 посылок/час | standardbots.com | english.news.cn (Xinhua) |
| Робот-уборщик промышленный | 15 000–80 000 | 700–4 860 м²/час | grabarobot.com | en.orionstar.com |
| Кобот pick-and-place | 40 000–150 000 | 400–800 циклов/час | standardbots.com | industrialmonitordirect.com |
| Сервисный робот доставки | 15 000–40 000 | 25–30 доставок/сутки | relayrobotics.com | chla.org |
| ИИ-инспекция качества | 30 000–200 000 | 10 000–72 000 деталей/час | averroes.ai | ifactoryapp.com |

Две оговорки, которые стоит знать до демонстрации:

- **Паллетайзер** — источник даёт 15–130 единиц в минуту; переведено в час умножением на 60 без
  изменения границ. Это единственное арифметическое действие над источником во всей таблице.
- **Сервисный робот доставки** — 25–30 доставок в сутки это измеренная выработка Moxi в детской
  больнице Лос-Анджелеса, причём источник отдельно отмечает, что это «примерно половина»
  возможностей машины. Верхнюю границу **не поднимали**: «примерно половина» — это не число.

Диапазоны обслуживания, энергии и лицензий у классов — не цитаты, а порядок величины по тому же
правилу, что и у вендорских строк (обслуживание ≈ 8% CAPEX/год). Они не выдаются за
опубликованные цифры и, как и всё остальное, редактируются пользователем в допущениях.

## Regional presets: labor wages + energy factors

The calculator offers opt-in **Regional presets** that set both `laborCostPerHourUsd` and
`energyCostFactor` by selecting a region. Picking a region is entirely optional; users can always
edit both figures independently below the selector.

| Region | Avg. monthly wage (₽, 2025) | Labor/hour (₽) | Energy factor | Source |
|---|---|---|---|---|
| Москва | ~180,860 | 1,077 ₽ | 1.0 (reference) | Rosstat-based average; energy tariff baseline |
| Санкт-Петербург | ~121,475 | 723 ₽ | 0.95 | Rosstat-based average; regional tariff ~5% lower |
| РФ — среднее | ~100,360 | 597 ₽ | 0.9 | Rosstat-based 2025 RF average; tariff ~10% lower |
| Низкозатратный регион (СКФО) | ~46,281 | 275 ₽ | 0.8 | North Caucasus (e.g. Ingushetia, Chechnya) low-cost reference; ~20% lower tariff |

**Derivation:**
- **Labor cost per hour:** cited 2025 average monthly wage (Rosstat) ÷ ~168 working hours/month,
  held **in rubles** — the unit the source publishes — and converted to USD at whatever
  `usdToRub` the user currently has set. The table previously listed a USD figure derived once at
  90 ₽/$, which stopped matching its own citation the moment that editable assumption changed: at
  110 ₽/$ the Москва preset implied 1,320 ₽/h against the cited 1,077, a 23% overstatement of a
  figure this document presents as sourced.
- **Energy factor:** approximate regional index relative to Москва = 1.0, based on RF industrial
  electricity-tariff variation (~±30% typical). This is a *multiplier* on the annual energy cost
  estimate, not a per-kWh rate. Regional tariffs vary; this figure is an order-of-magnitude
  regional proxy.

**⚠ Before a live client demo, VERIFY:**
- **Verify each region's current average wage** against the latest Rosstat / regional labour board
  data, as labor-cost presets drift annually.
- **Verify the energy factor** against the target region's current industrial tariff. The table
  figures are approximate regional indices; real industrial rates vary by utility and contract
  terms.

---

# Стоимость труда и нормативы выработки

> Собрано 2026-09-11 для подпроекта A (`docs/superpowers/specs/2026-09-11-market-driven-economics-design.md`).
> Эти два показателя входят в **каждое** число продукта, поэтому собраны отдельно и с гейтом
> подписи. Ставка труда — доминирующий рычаг модели: она и занятость по задаче входят в годовую
> экономию линейно и мультипликативно, и их размахи в диаграмме чувствительности совпадают.

## Стоимость труда, склад и производство, РФ

**Найдено.** Пять независимых зарплатных обзоров, месячный оклад ДО вычетов:

| Источник | Значение | URL |
|---|---|---|
| ГородРабот.ру, кладовщик-комплектовщик, РФ 2026 | 82 867 ₽/мес | https://russia.gorodrabot.ru/salaries/kladovshchik-komplektovshchik |
| Rambler, упаковщик, РФ 2026 | 58 000–71 000 ₽/мес (Москва 70 000) | https://www.rambler.ru/pro/zarplata/55951402-skolko-zarabatyvaet-upakovschik-realnye-tsifry-na-2026-god/ |
| DreamJob, кладовщик-комплектовщик, РФ 2026 | 90 000 ₽/мес (типично от 80 000) | https://dreamjob.ru/salary/kladovschik-komplektovschik/city-moskva |
| SuperJob, кладовщик, производство | максимум: Москва 135 000, СПб 110 000, Екб 100 000 | https://www.superjob.ru/pro/5944/ |
| Rabota.ru, комплектовщик | 109 000–150 000 ₽/мес | https://www.rabota.ru/career/catalogue/logistics/order-picker/ |

Две последние строки — **максимумы и московская премия**, а не средние; в центральную оценку не
входят, служат верхней границей правдоподобия.

**Взносы работодателя.** Единый тариф **30%** с выплат до предельной базы, 15,1% сверх
(п. 3 ст. 425 НК РФ). Предельная база 2026 — **2 979 000 ₽**.

| Источник | URL |
|---|---|
| 1С:БИТ, тарифы 2026 | https://www.1cbit.ru/blog/strakhovye-vznosy-tarify-izmeneniya-i-raschyet/ |
| Контур.Экстерн, таблица ставок 2026 | https://www.kontur-extern.ru/info/esn-strahovye-vznosy |
| Контур, предельная база 2026 | https://kontur.ru/articles/4261 |

При окладе 65 000–90 000 ₽/мес годовая база (780 000–1 080 000 ₽) **ниже предельной**, поэтому
применяется полные 30% без перехода на 15,1%.

### Расчёт — наш, не цитата

```
оклад до вычетов          65 000 – 90 000 ₽/мес   (центральный диапазон, без московской премии)
× 1,30 (взносы)          = 84 500 – 117 000 ₽/мес
÷ 166,67 ч/мес           = 507 – 702 ₽/час        (hoursPerYear = 2000 ÷ 12)
÷ 90 ₽/$ (usdToRub)      = $5,63 – $7,80/час
центр                    = $6,7/час
```

**Итог: `laborCostPerHourUsd` = 6,7; допустимый диапазон 5,6–7,8.**
Нынешнее значение **15** — западная ставка, ошибка примерно в 2,2 раза.

Арифметика показана целиком намеренно: цитируются оклад и тариф взносов, а перевод в часовую
стоимость работодателя — наш, и он обязан быть проверяемым, а не выглядеть цитатой.

## Нормативы выработки человека по задачам

Собрано 2026-09-11. Нормы человеческого труда физичны и не привязаны к региону, поэтому
источники англоязычные — по этим операциям они на порядок строже русскоязычных.

| задача | норматив | статус |
|---|---|---|
| уборка | **650 000 м²/год** | ✅ ISSA |
| отбор заказов | **80–120 отборов/час** | ✅ CognitOps, по вертикалям |
| сортировка | **200–300 посылок/час** | ✅ Tompkins Robotics, проверено на странице |
| инспекция качества | ~240–360 деталей/час | ⚠️ только фармацевтический флакон, не общая норма |
| паллетирование | — | ❌ искали дважды, НЕ НАЙДЕНО |
| доставка | — | ❌ НЕ НАЙДЕНО; источник прямо пишет, что единого стандарта нет |

### ✅ Уборка — ISSA Cleaning Times Database

ISSA (International Sanitary Supply Association) ведёт базу нормативов более чем по двумстам
операциям уборки — самый цитируемый отраслевой справочник в этой области.

| показатель | значение | в метрике |
|---|---|---|
| Уровень 2 «Ordinary Tidiness», коммерческий офис | 28 000 ft²/FTE за смену | **2 601 м²/смена** |
| Уровень 1, здравоохранение | 15 000 ft²/FTE за смену | 1 394 м²/смена |
| пылесос, стандартный офис | 2 500 ft²/час | 232 м²/час |
| влажная уборка твёрдых полов | 3 000 ft²/час | 279 м²/час |

Источник: https://www.mastercleanhq.com/blog/commercial-cleaning-industry-benchmarks-staffing-frequency
(явно ссылается на ISSA Cleaning Times Database, 2023). Первичный справочник платный;
это вторичная цитата с названным первоисточником — тот же статус, что у сторонних оценок цен.

**Наш расчёт:** 2 601 м²/смена × 250 смен = **650 250 м²/год**.

Нынешнее значение `areaPerCleanerPerYear` — 600 000, помеченное «порядок величины, а не цитата».
Оно оказалось верным с точностью до 8%. Предлагаю 650 000 и снять пометку: теперь это цитата.

### ✅ Отбор заказов — CognitOps, по вертикалям

https://cognitops.com/warehouse-pick-rate-benchmarks-by-industry/

| вертикаль | отборов/час на человека |
|---|---|
| общий ассортимент, ручной отбор | 150–250 (верх), 80–130 смешанный батч |
| электронная торговля, смешанный отбор | 80–120, зоны высокой оборачиваемости 150+ |
| холодный склад | 80–120 (95–110 конкурентно) |
| фармдистрибуция со сканированием | 50–90 |
| **B2B, отбор коробами и паллетами** | **40–70** |

Центральная оценка для класса: **80–120 отборов/час** → 160 000–240 000 отборов/год при 2000 ч.

### ✅ Сортировка — Tompkins Robotics

Проверено на самой странице, не по сниппету:

> «Manual sortation typically handles **200 to 300 items per worker per hour**.»

https://www.tompkinsrobotics.com/blog/why-your-as/rs-needs-a-sortation-system-to-be-effective

→ **400 000–600 000 посылок/год** при 2000 ч.

### ⚠️ Инспекция — найдено, но узко

Рецензируемый источник по визуальному контролю в фармацевтике
(https://pmc.ncbi.nlm.nih.gov/articles/PMC3066354/) даёт цитируемый факт:

> «an inspection booth where a **5-s inspection duration** is used in front of each color background»

Два фона по 5 с плюс манипуляция → порядка 240–360 единиц/час. **Арифметика наша, не цитата.**

**Не заводим.** Это норма осмотра фармацевтического флакона, а `class-ai-inspection` покрывает
21 тип объекта — от пищевого производства до горнодобычи. Распространять флаконную норму на
контроль отливок или сортировку руды — это ровно та подмена, которую запрещает правило двух
концов. Поле остаётся пустым, занятость вводит человек.

### ❌ Паллетирование — искали дважды, не нашли

Русскоязычный запрос про норму выработки ручной укладки возвращает **геометрию паллеты**:
сколько коробок влезает на европоддон, высота штабеля, распределение веса. Англоязычный запрос
через нормативы эргономики выводит на **уравнение подъёма NIOSH** — а оно о безопасной массе
груза, а не о производительности в час.

Открытой нормы производительности ручного паллетирования нет.

### ❌ Доставка — не найдено, и это задокументировано в отрасли

Запросы выводят на перевозки скорой помощи и оплату смен медперсонала. Статья о
бенчмаркинге внутренней транспортной службы больницы прямо пишет, что единого стандарта, по
которому её можно оценить, **не существует** (https://towne.com/ready-benchmark-hospitals-internal-transport-service/).

### Исход по решению Р-2

Три задачи получают предзаполнение со ссылкой. Три остаются с пустым полем и считаются только
после ввода человеком. Ни одно число не выдумано.

Это **предусмотренный исход**, а не пробел: по решению Р-2 спеки задача без норматива не
получает предзаполнения, поле занятости остаётся пустым, и расчёт выполняется только после
того, как человек введёт число сам. Ни одна задача не пропадает, ни одно число не выдумано.

**Следствие для задачи 9 плана:** экран «кто чем занят» проектируется под смешанный случай —
часть полей предзаполнена и помечена ссылкой, часть пуста с подсказкой «введите, иначе задача
не будет посчитана». Соотношение — три к трём.

## Исправление к спеке: `opsPerWorkerPerYear` неверно для ВСЕХ задач

В спеке `2026-09-11-market-driven-economics-design.md`, раздел Л-1, написано: «12 500 операций
в год — это 6 операций в час. **Для отбора заказов правдоподобно.** Для укладки коробок —
ошибка в пятьдесят раз».

Первая половина неверна, и сбор нормативов это показал. Отбор заказов — 80–120 в час
(CognitOps), то есть 160 000–240 000 в год. Нынешние 12 500 занижены **в 13–19 раз и для
отбора тоже**. Шесть отборов в час не является правдоподобным ни для одной складской операции.

Это усиливает вывод подпроекта A, а не ослабляет: глобальный делитель ошибался не на одной
задаче из двух, а на обеих, — и всегда в сторону завышения замещаемого персонала, то есть
лести.
