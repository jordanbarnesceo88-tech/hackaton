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

## Regional presets: labor wages + energy factors

The calculator offers opt-in **Regional presets** that set both `laborCostPerHourUsd` and
`energyCostFactor` by selecting a region. Picking a region is entirely optional; users can always
edit both figures independently below the selector.

| Region | Avg. monthly wage (₽, 2025) | Labor/hour (USD) | Energy factor | Source |
|---|---|---|---|---|
| Москва | ~180,860 | $12.0 | 1.0 (reference) | Rosstat-based average; energy tariff baseline |
| Санкт-Петербург | ~121,475 | $8.0 | 0.95 | Rosstat-based average; regional tariff ~5% lower |
| РФ — среднее | ~100,360 | $6.6 | 0.9 | Rosstat-based 2025 RF average; tariff ~10% lower |
| Низкозатратный регион (СКФО) | ~46,281 | $3.1 | 0.8 | North Caucasus (e.g. Ingushetia, Chechnya) low-cost reference; ~20% lower tariff |

**Derivation:**
- **Labor cost per hour:** cited 2025 average monthly wage (Rosstat) ÷ ~168 working hours/month ÷ 90
  (the app's USD→RUB reference rate), rounded.
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
