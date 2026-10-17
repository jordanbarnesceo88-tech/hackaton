import type { OpenApiDocument, OpenApiOperation, OpenApiResponse } from "./openapi";

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const response = (description: string, schema: Schema = ref("Error")): OpenApiResponse => ({ description, content: { "application/json": { schema } } });
const receipt = { type: "object", required: ["job"], properties: { job: ref("CalculationJobReceipt") } };
const emptyBody = { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } };
const id = { name: "id", in: "path" as const, required: true, description: "Номер своей операции расчёта", schema: { type: "string" } };
const commonErrors = {
  "401": response("Требуется сессия пользователя"), "404": response("Операция не найдена или принадлежит другому пользователю"),
  "503": response("Временная ошибка; повторяйте отправку с прежним Idempotency-Key"),
};
const operation = (operationId: string, summary: string, description: string, extra: Partial<OpenApiOperation>): OpenApiOperation => ({
  operationId, summary, description, tags: ["Расчёт и проекты"], "x-access": "user", security: [{ sessionCookie: [] }], responses: commonErrors, ...extra,
});

export const JOB_SCHEMAS: Record<string, Schema> = {
  CalculationJobReceipt: {
    type: "object", description: "Компактное состояние операции без полного входа и результата. Все даты — ISO 8601 UTC.",
    required: ["id", "jobId", "runId", "operation", "status", "stage", "publicationState", "safeMessage", "resultUrl"],
    properties: {
      id: { type: "string" }, jobId: { type: "string" }, runId: { type: "string" },
      operation: { enum: ["CREATE", "SAVE", "RECALCULATE", "CALCULATE"] },
      status: { enum: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] },
      stage: { type: "string" }, progress: { type: ["number", "null"], description: "null, пока нет измеримого процента выполнения" },
      safeMessage: { type: "string" }, publicationState: { enum: ["NONE", "PUBLISHED", "STALE"] },
      projectId: { type: ["string", "null"] }, reservedProjectId: { type: ["string", "null"] }, publishedRevision: { type: ["integer", "null"] },
      attempts: { type: "integer" }, createdAt: { type: "string", format: "date-time" },
      startedAt: { type: ["string", "null"] }, finishedAt: { type: ["string", "null"] },
      diagnosticCode: { type: ["string", "null"] }, cancelRequestedAt: { type: ["string", "null"] },
      engineRelease: { type: "string" }, resultUrl: { type: "string" },
    },
  },
  CalculationJobRequest: {
    oneOf: [
      { type: "object", additionalProperties: false, required: ["operation", "facility", "name"], properties: {
        operation: { const: "CREATE" }, facility: { enum: ["warehouse", "airport", "medical"] }, name: { type: "string", minLength: 1, maxLength: 120 },
        objectName: { type: ["string", "null"], maxLength: 200 }, params: { type: "object" }, scenarios: { type: "array", items: ref("ScenarioSpec") },
        paramsSource: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { enum: ["manual", "upload", "api", "demo"] }, fileName: { type: "string", maxLength: 255 } } },
      } },
      { type: "object", additionalProperties: false, required: ["operation", "facility"], properties: {
        operation: { const: "CALCULATE" }, facility: { enum: ["warehouse", "airport", "medical"] }, params: { type: "object" }, scenarios: { type: "array", items: ref("ScenarioSpec") },
      } },
      { type: "object", additionalProperties: false, required: ["operation", "projectId", "expectedRevision", "params", "scenarios"], properties: {
        operation: { const: "SAVE" }, projectId: { type: "string", maxLength: 128 }, expectedRevision: { type: "integer", minimum: 0 }, name: { type: "string", maxLength: 120 },
        params: { type: "object" }, scenarios: { type: "array", items: ref("ScenarioSpec") }, changes: { type: "array", items: { type: "object" } },
      } },
      { type: "object", additionalProperties: false, required: ["operation", "projectId", "expectedRevision"], properties: {
        operation: { const: "RECALCULATE" }, projectId: { type: "string", maxLength: 128 }, expectedRevision: { type: "integer", minimum: 0 },
      } },
    ],
  },
};

export const JOB_PATHS: OpenApiDocument["paths"] = {
  "/api/v1/calculation-jobs": {
    post: operation("enqueueCalculationJob", "Поставить расчёт в очередь", "Фиксирует проверенный сервером вход и справочники. Повтор одинакового намерения с тем же ключом возвращает прежнюю операцию до проверки текущей ревизии и квот. Другие данные с тем же ключом — 409. Тело до 4 МиБ. До 2 активных операций на пользователя и 100 на платформу; история до 200/2000. Выполнение требует отдельного worker.", {
      parameters: [{ name: "Idempotency-Key", in: "header", required: true, description: "Уникальный ключ операции, сохраняемый при сетевом повторе", schema: { type: "string", pattern: "^[a-zA-Z0-9._:-]{1,128}$" } }],
      requestBody: { required: true, content: { "application/json": { schema: ref("CalculationJobRequest") } } },
      responses: { ...commonErrors, "202": { ...response("Принято; используйте Location и компактный GET для опроса", receipt), headers: { Location: { schema: { type: "string" } }, "Retry-After": { schema: { type: "integer" } } } },
        "403": response("Запрос с постороннего Origin"), "409": response("Конфликт ключа или ревизии проекта"), "410": response("Результат удалён: старый ключ не создаёт новый расчёт"), "413": response("Тело или серверный снимок превышает предел"), "415": response("Требуется JSON"), "422": response("Ошибка входных данных"), "428": response("Требуется expectedRevision"), "429": response("Очередь или история заполнена; HISTORY_FULL требует очистки завершённых результатов") },
    }),
    get: operation("listCalculationJobs", "Список своих операций", "Возвращает последние 30 операций владельца без удалённых результатов; можно фильтровать по проекту. Полные результаты и входы в список не включаются.", {
      parameters: [{ name: "projectId", in: "query", description: "Необязательный идентификатор проекта", schema: { type: "string", maxLength: 128 } }],
      responses: { ...commonErrors, "200": response("Список", { type: "object", properties: { jobs: { type: "array", items: ref("CalculationJobReceipt") } } }), "422": response("Некорректный фильтр") },
    }),
  },
  "/api/v1/calculation-jobs/{id}": {
    get: operation("getCalculationJob", "Состояние своей операции", "Компактный ответ для опроса. Закрытие страницы или обрыв HTTP не отменяют сохранённую операцию. SUCCEEDED и STALE означают готовый результат без изменения проекта.", { parameters: [id], responses: { ...commonErrors, "200": response("Состояние", receipt) } }),
    delete: operation("removeCalculationJobResult", "Удалить технический результат", "Удаляет большие вход и результат только завершённой собственной операции. Сохранённый проект и его архив остаются. Небольшой маркер ключа сохраняется, чтобы поздний повтор не воссоздал удалённый результат или проект.", { parameters: [id], requestBody: emptyBody, responses: { ...commonErrors, "200": response("Удалено", { type: "object", properties: { ok: { const: true } } }), "403": response("Посторонний Origin"), "409": response("Операция ещё активна"), "415": response("Требуется JSON"), "422": response("Требуется пустой объект {}") } }),
  },
  "/api/v1/calculation-jobs/{id}/cancel": {
    post: operation("cancelCalculationJob", "Отменить свою операцию", "Явная отмена запрещает последующую публикацию результата. RUNNING может некоторое время завершать вычисление; успешный ответ подтверждает запрет записи. Уже опубликованный результат отменить нельзя.", { parameters: [id], requestBody: emptyBody, responses: { ...commonErrors, "200": response("Отмена принята", receipt), "403": response("Посторонний Origin"), "409": response("Операция уже завершена"), "415": response("Требуется JSON"), "422": response("Требуется пустой объект {}") } }),
  },
  "/api/v1/calculation-jobs/{id}/result": {
    get: operation("getCalculationJobResult", "Результат своего запуска", "Читает сохранённый результат без пересчёта. При конфликте ревизии публикация STALE, проект не изменён. submitted содержит только пользовательские поля SAVE; внутренний каталог и служебный конверт не выдаются.", { parameters: [id], responses: { ...commonErrors,
      "200": response("Завершённая операция", { type: "object", properties: { job: ref("CalculationJobReceipt"), results: { oneOf: [ref("ProjectResults"), { type: "null" }] }, submitted: { type: ["object", "null"] } } }),
      "202": response("Операция ещё выполняется; results пока null", { type: "object", properties: { job: ref("CalculationJobReceipt"), results: { type: "null" }, submitted: { type: ["object", "null"] } } }),
    } }),
  },
};
