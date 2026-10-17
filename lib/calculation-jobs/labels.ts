import type { JobReceipt } from "./types";

export const operationLabels: Record<string, string> = {
  CREATE: "Создание проекта", SAVE: "Сохранение расчёта", RECALCULATE: "Пересчёт проекта", CALCULATE: "Расчёт без публикации",
};
export const statusLabels: Record<JobReceipt["status"], string> = {
  QUEUED: "В очереди", RUNNING: "Выполняется", SUCCEEDED: "Завершён", FAILED: "Ошибка", CANCELLED: "Отменён",
};
export const stageLabels: Record<string, string> = {
  queued: "Ожидание запуска", preparing: "Подготовка сохранённого входа", calculating: "Расчёт",
  economics: "Экономика и подбор решений", spatial: "Проверка пространственной модели",
  simulation: "Имитация работы парка", finalizing: "Подготовка результата", publishing: "Атомарное сохранение результата",
  "spatial-check": "Проверка движения на планировке", "fleet-search": "Проверка вариантов численности парка",
  retry_pending: "Восстановление расчёта", succeeded: "Готово",
  completed: "Готово", failed: "Ошибка", cancelled: "Отменён",
};
