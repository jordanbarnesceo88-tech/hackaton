/**
 * Имитация склада (sim-1.0.0): планировка, маршруты, аналитический цикл, движок, сводка,
 * перебор парка, запуск, адаптер входа и строки выгрузки. Чистый TS без React, DOM, Prisma и
 * часов — одинаково работает на сервере и в браузере.
 */
export * from "./types";
export * from "./rng";
export * from "./layout";
export * from "./routing";
export * from "./analytic";
export * from "./state";
export * from "./engine";
export * from "./dispatch";
export * from "./metrics";
export * from "./sweep";
export * from "./runner";
export * from "./adapter";
export * from "./export-rows";
