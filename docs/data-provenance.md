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
