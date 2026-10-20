# Независимое hostile review реального нагрузочного прогона a944

Вердикт: **SCOPED_RAW_REVIEW_PASS / BENCHMARK_FAIL**. Сохранённый отчёт верно показывает неуспех требования «готовый результат каждому из 50 клиентов за 60 секунд». 36/50 клиентов превысили 60 секунд. PASS иных критериев нельзя превращать в общий PASS. Новых нагрузок, DB/HTTP-запросов или изменений приложения/package не выполнялось.

Источник: report.json SHA256 98a6bb533b6b303c14367d906e6705edccc9f57ac760646cfa90b9828656771a. Независимый runner independent-raw-review.cjs SHA256 9e26622fee6d786b672b392f859abfda49d60c8b161cc1ede1bf527412c60a3d; машинный результат independent-raw-review.json. В нём 10 730 отдельных assertions, все PASS; это проверки сохранённых доказательств, не новые нагрузочные операции.

## Перепроверенные результаты

- 1 reference +2 smoke +50 burst: 53 различных owner/job/run/idempotency-key, 53 raw receipt SHA совпадают с report. У всех первая отправка202, result200, SUCCEEDED, attempts1. Отсутствуют SQL-reconciled admission, транспортные/JSON/verification errors, повторные попытки и неоконченные результаты.
- Нагрузочный контур HTTP3086/DB55438,3worker,globalcap2; source/helper/image/engine hashes согласованы с reviewed frozen runner. App и3worker container ID/image/start/engine/resources до/после совпадают. CPU/memory limits=0 явно означают unlimited в пределах Docker host, не обещают ограниченный production budget. Setup/auth закончились до измеряемых phases.
- Первый POST только один на client по inspected runner; cookies каждой session проверяются на отдельный owner до измерения. Сохранённые SQL audit rows привязаны к правильному owner/job/run/idempotency-key, engine a944.../alfa-durable-calculation-1, inputHash и отдельному CALCULATE result без публикации в существующий проект. Raw result POST/GET не заменён reference-result: каждый job имеет свои start/finish и stored verification.
- SQL queue/compute/serverTotal независимо совпали с createdAt/startedAt/finishedAt raw receipts; все durations finite>=0 и sum сходится. Recorded monotonic client timing упорядочен headers→parsed ACK→terminal→parsed result и включает queue+compute. Independent DB verification идёт после фиксации clientResultMs и не включена в него.
- Пересчитаны nearest-rank percentile из всех исходных samples: burst ACKp95=5963.9015мс; queuep95=170928мс,max178517; compute/storep95=8008мс,max8140; parsed-client-resultp95=185183.1861мс,max192688.6656. 36 из50 (72%) выше60с, computeAbove60=0.
- Lease monitor720samples на SQL clock_timestamp показывает max2. Дополнительно sweep всех53 raw stored execution start/finish intervals даёт maxoverlap2; interval остаток0. Это сильнее одного sampled maximum, но не независимое перепроигрывание scheduler.
- Health189samples p95=72.2816мс,max2779.3079мс; burst polling4432samples p95=160.3553мс,max2658.0795мс. Предварительно объявленные responsiveness пороги соблюдены, HTTP/DB health ошибок нет.

## Физика и деньги

У каждого из53 receipts проверены purchase иRaaS: исходный N6/C2/seed1/closed-pod-1, source/test canonical identities, равенство полного nominal/controlled executor кроме demand. Nominal terminal PARTIAL остаётся51.5пал/ч при цели51.8181818...; healthy review безreasons. Controlled protocol periodic-110-15-120-cohort-closed-1 terminalPASS: окно900..8100с, offered/arrived57, delivered110=>55/ч,closed109=>54.5/ч,cohort bounds корректны. Контролируемый поток не выдан за raw nominalOK.

Финансовая сигнатура одинакова у всех53 владельцев; independently сверены cashflow identities, cumulative values, discounting, NPV, gross/netROI, full-periodTCO иcash effect. PurchaseNPV4 079 992.1238₽ положителен отдельно от spatial qualification. Это агрегатная проверка сохранённой CF-модели, не натурная калибровка её допущений.

## Что этот результат означает

Durability PASS:50/50 приняты, выполнены и получили проверенный stored result безretry. Compute/store60 PASS:каждый фактический расчёт занял менее60с. Responsiveness PASS по объявленным порогам. **Client result60 FAIL:** очередь при3workers/globalcap2 не выдаёт готовый результат всем50 одновременным клиентам за60с. Очередь сохраняет работу, но не выполняет это end-to-end требование. Быстрый202 и длительность одного расчёта8с не заменяют время результата клиента185с p95.

Нельзя утверждать, что простое увеличениеcap/workers решит проблему: такого измерения не проводилось. Этот единственный run не доказывает recovery, fault tolerance после падений, browser/GPU performance, постоянный throughput, поддержку произвольных50 проектов или промышленную калибровку.

## Пределы независимости

Проверка read-only иoffline. SQL больше не опрашивался: использованы сохранённые SQL audit rows иHTTP receipts; исходные secret cookies не запрашивались. Timing изperformance.now проверен на внутреннюю согласованность и inspected runner; независимого packet trace нет. Monitors sampled250мс; дополнительно проверены сохранённые интервалы выполнения. Hashes ифинансовая арифметика не доказывают физическое соответствие реальному складу.
