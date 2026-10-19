# Текущий сдаточный комплект

19 октября 2026 г.: tz-1.0.8 / sim-1.2.1 / warehouse-dense-underlift-1.9.1.

- [presentation.pdf](./presentation.pdf) — 15 слайдов продукта, алгоритма, источников, архитектуры и плана развития.
- [documentation.pdf](./documentation.pdf) — руководство по функционалу, моделям, данным, архитектуре и запуску.
- sample-report.pdf/csv/xlsx — реальные выгрузки сохранённого N6/C2 проекта.
- [calculation-source.json](./calculation-source.json) — вход, версия, операция и сохранённый результат.
- Три *-receipt.json — реальные серверные ответы; [demo-numbers.md](./demo-numbers.md) содержит числа и допущения.
- [content-coverage.json](./content-coverage.json) — карта обязательного содержания документов; не общий вердикт соответствия.
- queue-*.json — Measured c390 image pair: 50 verified results, workers/cap 14/14; load PASS, client60 PASS, compute60 PASS, responsiveness PASS. Current real CREATE recovery: PASS; attempts 2. Scope is one exact frozen input/run, not throughput SLA. Исторические серии и восстановление CREATE оцениваются только для своих версий и профилей. Методика в [CALCULATION_JOBS](../../CALCULATION_JOBS.md#нагрузочная-проверка-методика-и-область).
- [release-manifest.json](./release-manifest.json) — SHA256 и границы приёмки.

Номинальный прогон сохранён отдельно как PARTIAL; capacity PASS подтверждает только объявленный контролируемый тест полного цикла. Это кандидат для дальнейшей проверки, без общей рекомендации полного внедрения. Учебные данные не являются коммерческими условиями заказчика. Локальная приёмка не означает обновление внешнего стенда. Документы на уровень выше архивные.
