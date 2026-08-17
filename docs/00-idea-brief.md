# Idea Brief (source of truth — fixed, not to be re-brainstormed)

> This is the original task/idea as given by the organizer. Verbatim, unedited.
> Execution approach, architecture, and scope are what we brainstorm — not this.

## Original text (RU)

Компании, рассматривающие роботизацию, сталкиваются с двумя барьерами: непониманием
какие решения существуют на рынке и невозможностью быстро оценить экономический эффект
применительно к своему объекту. Рынок роботизированных решений фрагментирован –
информация о продуктах, их характеристиках и реальных показателях эффективности
разрознена. Вендоры дают оценки в свою пользу, независимого инструмента сравнения нет.
В результате решения об инвестициях в роботизацию откладываются или принимаются без
достаточного обоснования.

### Описание задачи

Разработать платформу, которая позволяет пользователю:

**Шаг 1. Выбор отрасли и типа объекта**

Пользователь выбирает отрасль и тип объекта для роботизации:
- Торговля: склад (с примерами данных от организатора)
- Логистика: аэропорт (с примерами данных от организатора)
- Социальная сфера: медучреждение (с примерами данных от организатора)
- Другое: произвольный объект на усмотрение пользователя

**Шаг 2. Подборка и сравнение решений**

Платформа показывает доступные на рынке роботизированные решения для выбранного типа
объекта: типы решений и отдельные продукты внутри каждого типа, их ключевые
характеристики и сравнительные показатели. Данные частично предоставляются
организатором, частично собираются командой из открытых источников.

**Шаг 3. Расчёт экономики**

Пользователь вводит параметры своего объекта (площадь, объём операций, численность
персонала и др.) и выбирает тип решения. Платформа рассчитывает потребность в
ресурсах и экономические эффекты: OPEX, CAPEX, срок окупаемости, ROI и пр.

**Шаг 4. Визуализация**

Платформа показывает имитацию работы роботов на объекте с отображением ключевых
показателей в реальном времени.

### Ресурсы

- Таблица роботизированных решений с характеристиками и показателями эффективности
  (предоставляется организатором)
- Обезличенные примеры параметров реальных объектов
- Перечень открытых источников для дополнительного парсинга данных о решениях

### Описание итогового продукта

Веб-платформа с пошаговым интерфейсом: выбор объекта → подборка и сравнение решений →
ввод параметров и расчёт экономики → визуализация работы роботов.

Продукт должен быть готов к демонстрации реальному клиенту.

## Working English summary

A web platform for companies evaluating robotization investment. Solves two problems:
(1) fragmented, vendor-biased info on available robotic solutions, (2) no fast way to
estimate ROI for a specific facility. Four-step user flow: pick industry/facility type
→ browse & compare available robotic solutions → input facility parameters and get
OPEX/CAPEX/payback/ROI → see a real-time visualization/simulation of robots operating
on the facility. Data comes partly from the organizer (solutions table + anonymized
facility examples), partly from open-source scraping/parsing by the team. Must be
demo-ready for a real client.

## Notable constraints (observed, not invented)

- Fixed deadline-driven, demo-focused deliverable — reads as a hackathon/case-study
  build, not a long-horizon production system. Scope decisions should bias toward "looks
  and works convincingly in a live demo" over "handles every edge case."
- Data sourcing is a mixed bag: organizer-provided structured data (reliable) +
  open-source scraping (unreliable, needs validation/normalization layer).
- "Другое: произвольный объект" (Step 1's "Other" option) implies the parameter input
  and economics engine can't be hard-coded per the 3 known verticals only — needs at
  least a generic fallback model.
- Visualization requirement ("real-time simulation of robots on-site") is likely the
  highest execution-risk item — needs an explicit build-vs-fake decision early.
