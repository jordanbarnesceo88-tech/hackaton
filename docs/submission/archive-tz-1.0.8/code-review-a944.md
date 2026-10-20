# Stage2 a944: итоговая сквозная проверка замороженных исходников

Дата: 19 октября 2026 года. Область — изменения после `2403c14`, включая новые файлы, которых нет в обычном `git diff`. Проверена цепь API/каталог → frozen input → nominal/controlled replay → финансы/вывод → сохранённый проект → архив/экспорт. Производственный код, БД и пакет поставки не менялись; созданы только внешний repro и этот отчёт.

**Вердикт: P0/P1 не обнаружены; один подтверждённый P2 остаётся открытым. Полный PASS всего выпуска не выдан.** Координатор принял P2 как `OPEN_FOR_NEXT_SOURCE_RELEASE`; исправление должно войти в следующую сборку, не подменяя результаты существующих проектов a944.

Часть labour/norm archive реализации ранее написана этим агентом. Здесь выполнена её повторная сквозная самопроверка, а не заявлена новая независимая peer-приёмка собственного кода. OEM-материалы и текущие capacity/server/narrative изменения принадлежат другим авторам; по ним проверка независимая. Предыдущие независимые verdict и реальные функциональные gates остаются отдельными доказательствами.

## Подтверждённый P2: неизвестный производитель превращается в конкретный OEM

**Место:** `lib/implementation/resources.ts:226–234`, особенно `manufacturer == null || ...`.

**Воспроизводимый ввод:**

```text
buildImplementationSnapshot('inventory', null, undefined, 'Робот-инвентаризатор')
→ resources: yandex-inventory-market-case, manufacturer='Яндекс Роботикс'

buildImplementationSnapshot('cleaner', null, undefined, 'C5')
→ resources: agibot-c5-spec, manufacturer='AGIBOT Innovation (Shanghai) Technology Co., Ltd.'
```

Название «Робот-инвентаризатор» — общий alias; неизвестный производитель не подтверждает Яндекс. Сокращение C5 тоже используется без привязки бренда. Функция различает запрос всей class-страницы и конкретного продукта, но в product-level ветке всё равно снимает проверку бренда при null.

**Достижимая цепь:** `lib/api/import.ts:446` разрешает отсутствующий manufacturer; `lib/catalog/product-for-calc.ts:432` передаёт его в `buildImplementationSnapshot`. Полученный материал входит в `productSnapshots` и далее в карточку, `ImplementationGuidePanel`, `implementationReportRows`, PDF/CSV/XLSX. Ошибка атрибуции закрепляется в неизменяемом архиве. Проверки известных 18 источников не покрывают такой null-brand вход.

**Доказательство:** `RND/stage2-oem-null-brand-probe.ts` и `.json`; выполнен чистый TypeScript probe, без сети/БД. Оба приведённых результата фактически получены. Координатор независимо принял дефект.

**Минимальное исправление:** сохранить class-level список источников; product-level материалы по сокращённым/общим model aliases выдавать только при известном точном manufacturer. Самый небольшой безопасный вариант — не присваивать продукту OEM-материал при неизвестном производителе. Если поддержка полного брендированного названия без поля manufacturer нужна, задать отдельное узкое правило, не позволяющее generic aliases обходить проверку бренда. Старые снимки не backfill и не переписывать молча.

**Обязательные регрессии следующего выпуска:**

- manufacturer=null/undefined и общие «Робот-инвентаризатор», C5, CC1, AS-RS B не получают конкретный OEM без подтверждённой привязки;
- несовпадающий известный бренд и производная модель по-прежнему исключены;
- class-page список и позитивные известные производители сохраняют 18 материалов/13 классов;
- импорт неизвестного бренда → product snapshot → PDF/CSV/XLSX не добавляет чужой материал;
- старый сохранённый snapshot сохраняется неизменным, без live-подстановки нового реестра.

## Что проверено в остальных слоях

### Capacity и источник результата

- `deriveCapacityInput` оставляет исходную required goal, N/C, seed/mix и физические параметры; меняются только заранее объявленные warm-up 15 мин, measurement 120 мин и periodic offered=110%. Это отдельный тест, не изменение исходной финансовой нагрузки.
- Cohort accounting не зачтёт carry-in прогрева, незавершённого обязательного ребёнка, другой pod/route/parent или работу после конца окна. Для inbound требуется законченный matching prefetch; для outbound — matching return после delivery. Тесты включают отсутствующих/поддельных детей и границы окна.
- `spatial-server.ts` получает ожидаемый вход из server-built model, а не из заявленного клиентом proof. Он заново выполняет nominal и controlled replay, не доверяет submitted PASS и не наследует client layout/N/seed. Cache key различает явный запрос мощности; evidence между сценариями клонируется.
- Общий spatial allowance ограничен 45 с и outer deadline; timeout/cancellation не сохраняют submitted PASS. Неисполненная проверка становится NOT_EVALUATED; отсутствующие measurements в UI/экспорте не представлены измеренными нулями.
- Полные canonical identities используются для сравнения входов; короткие FNV-метки обозначены как визуальные и не участвуют в серверном доверии. Старая canonical identity допускается только как вход явного пересчёта, не становится текущей проверкой.

### Деньги и управленческий вывод

- Финансовая модель считает исходные параметры сценария, а не offered=110% теста. Controlled proof не пересчитывает годовой денежный эффект по двум часам и не меняет cash realization.
- `withCapacityCandidates` работает только при новом расчёте, на eligible single-item составе, exact evidence и healthy nominal review. Layout-blocked, MANUAL_ADD, stale и compound не получают общий кандидат по одной receipt.
- Отрицательная экономика не называется финансово перспективной; сохранённый nominal PARTIAL остаётся PARTIAL. `recommendedScenarioKey=null` не превращается в полную рекомендацию при одном capacity PASS.
- Новый frozen headline/bullets устраняет безусловное «измените парк» для квалифицированного кандидата, но сохраняет номинальное ограничение и различие пилота/полного внедрения.

### Labour, метаданные и архив

- Допустимость labour share 0–1 отделена от типового оценочного диапазона 0,3–0,7; явные 0/0,1/0,9/1 проходят API/core. Нестандарт, coverage и cash realization применяются отдельными множителями по одному разу. Это проверка формулы, не натурный хронометраж.
- Frozen definitions сохраняют source/label/basis/ranges. Архивные формы, norm report rows и журнал используют snapshot; отсутствие старой меты показывается явно, без live-нормативов. Дополнительный существующий override доступен для изменения/сброса в editable-контуре.
- `projectSnapshotModel` клонирует сохранённый результат; новый candidate narrative или текущий реестр OEM не запускается при чтении архива. `getOwnedProjectSnapshot` читает проект и журнал в RepeatableRead, переиспользует сохранённые norm/param labels и не перечитывает полный JSON ради подписей.

### Экспорт, геометрия и глобальные зависимости

- Capacity report rows используют две сохранённые receipt и отдельный номинальный health review. Старый архив без proof не получает live capacity test. Guide/provider/OEM экспорты читают product snapshot, а не live directory; подтверждённая проблема — именно неверное первоначальное OEM matching, описанное выше.
- Methodology formulas/limits/norm metadata берутся из frozen snapshot; old missing metadata помечена. Полная числовая сверка actual JSON/CSV/XLSX/PDF и layout текущих PDF принадлежат другим reviewer и этой проверкой не объявляются повторно пройденными.
- Локальный layout reuse привязан к полным layout params/source и возвращает отдельные клоны. Чтение оптимизированного point index сохраняет точный distance predicate и fallback для некорректно индексируемых координат. В просмотренных изменениях не найдено нового основания объявить непроверенный путь безопасным или заменить клиентскую геометрию.
- Поиск runtime исходников не выявил абсолютных Windows-import или привязки к основной БД; найденные localhost defaults относятся к переопределяемым инструментам capture/submission. Это не сканирование всех возможных зависимостей инфраструктуры.

## Фактически выполненная узкая проверка

```text
npx vitest run --project unit lib/sim/capacity-protocol.test.ts lib/sim/spatial-capacity-server.test.ts lib/sim/spatial-capacity-evidence.test.ts lib/tz/capacity-conclusion.test.ts lib/tz/econ/labour-domain.test.ts components/project/norms-archive.test.ts lib/report/tz/methodology-archive.test.ts lib/report/tz/implementation.test.ts lib/implementation/resources.test.ts lib/sim/identity.test.ts --maxWorkers 1
```

**71/71 PASS, 10/10 файлов**, начало 02:37:08, длительность 8,05 с, exit 0. Это pure/mock/SSR/export regression, не новый DB/HTTP/GPU или тяжёлый физический replay. Тесты не покрывают найденный null-brand P2: успешный suite не снимает дефект.

## Контрольные SHA исходников

| Файл | SHA-256 |
|---|---|
| `lib/implementation/resources.ts` | `534b6ee04d22420d9cfe87e7213083235e63214ce779ea9929bd33f4f987428f` |
| `lib/sim/capacity-protocol.ts` | `a0c34ce07e4d7d253ec92b12b08dcd0f00f49343e44f791c81b2053b879ef306` |
| `lib/sim/spatial-server.ts` | `1514ba9d63d8c9152a4e84b7224b700752d615aa887587829afe1db10b215d5a` |
| `lib/sim/spatial-evidence.ts` | `79db627da6412bed5ae28d4daebaf93539f931c79a0ea503915514909faae025` |
| `lib/tz/capacity-conclusion.ts` | `a49bce0afe2e735c732c4788180326bb82bde51cd53efdb4e7609e2023f5043d` |
| `lib/tz/model.ts` | `d2b776d5df096907062bca6ce12c49f4e1227fae53f6775c1d02bdb0e5396207` |
| `lib/tz/norms.ts` | `ebcfb3d3023103bd18567bd4d327ab847b356b52b09cecdc5b89588ba169e0b4` |
| `lib/tz/methodology.ts` | `f1726b5960e3d6c3f80b18c4cd71b4f1cfe8b2a5e2026aba3d8ec1280f12586c` |
| `lib/report/tz/implementation.ts` | `ace7bbf423b1f0fe595ed17350756098efc67e846196fa76c72c1cc4dbb49307` |

## Не смешивать с открытым P2

Реальный a944 load честно не выполнил client-result60 при cap 2: это установленная граница развёртывания, а не скрытый новый capacity/economics source defect. Реальные task-time, зарплатная реализация, цены контрактов, натурная выработка, сервисные SLA и калибровка торможения требуют внешних данных; здесь они не выдумываются. Airport/medical прототипы, полноценный CAD и WMS-интеграции не становятся реализованными из-за PASS warehouse тестов.

Не выполнены этим review: повтор full unit/DB/browser/GPU gates, промышленная сертификация, новая нагрузка, независимый пересчёт actual Excel/PDF-пакета и fuzz всех допустимых планировок. Ни одному из этих пунктов не присвоен общий PASS.
