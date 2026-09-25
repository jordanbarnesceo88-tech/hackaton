import type { PrismaClient } from "@prisma/client";

/**
 * Демо-проект склада с фиксированным id `demo-warehouse` (запасной путь жюри, ТЗ §4.2.7:
 * демонстрация на заранее загруженных данных). Пересоздаётся при каждом севе.
 *
 * В волне W2 это заглушка: проект строится из расчёта модели (T2.2) и реализуется в T3.6.
 * Сев (scripts/seed-v2.ts) уже вызывает функцию, чтобы T3.6 менял только этот файл.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- клиент понадобится реализации T3.6
export async function seedDemoProject(_prisma: PrismaClient): Promise<void> {
  /* реализуется в T3.6 */
}
