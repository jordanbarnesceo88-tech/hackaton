import type { Metadata } from "next";
import { ADMIN_TOKEN_MIN_LENGTH } from "@/lib/api/auth-constants";
import {
  ACCESS_LABELS,
  listOperations,
  OPENAPI,
  type FlatOperation,
  type OpenApiExample,
  type OpenApiMedia,
} from "@/lib/api/openapi";

/**
 * /api-docs — документация API платформы для людей (ТЗ §4.2.5 «документировать все API», §3.8).
 * Страница строится на сервере из того же объекта OPENAPI, что отдаёт /api/v1/openapi.json,
 * поэтому разойтись с ним не может. Swagger UI не используется: политика CSP сайта не
 * пускает скрипты со сторонних CDN, а таблица с примерами читается и без них.
 */

export const metadata: Metadata = {
  title: "API платформы — Платформа оценки роботизации",
  description: "Методы API для интеграций: каталог, нормативы, параметры объектов, расчёт и проекты",
};

const METHOD_STYLES: Record<FlatOperation["method"], string> = {
  get: "border-positive/40 text-positive",
  post: "border-primary/40 text-primary",
  put: "border-caution/40 text-caution",
  delete: "border-destructive/40 text-destructive",
};

/** Якорь операции: метод и путь латиницей. */
function anchorOf({ method, path }: Pick<FlatOperation, "method" | "path">): string {
  return `${method}-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
}

function MethodBadge({ method }: { method: FlatOperation["method"] }) {
  return (
    <span
      className={`inline-block min-w-12 rounded border px-1.5 py-0.5 text-center font-mono text-xs font-semibold uppercase ${METHOD_STYLES[method]}`}
    >
      {method}
    </span>
  );
}

/** JSON-пример в прокручиваемом блоке. */
function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Первый пример содержимого (JSON или другой тип). */
function examplesOf(content: Record<string, OpenApiMedia> | undefined): { type: string; examples: OpenApiExample[] }[] {
  if (!content) return [];
  return Object.entries(content)
    .map(([type, media]) => ({ type, examples: Object.values(media.examples ?? {}) }))
    .filter((c) => c.examples.length > 0);
}

function Operation({ item }: { item: FlatOperation }) {
  const { op, path, method } = item;
  const requests = examplesOf(op.requestBody?.content);
  return (
    <section id={anchorOf(item)} className="flex scroll-mt-20 flex-col gap-3 rounded-xl border p-4 sm:p-5">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        <MethodBadge method={method} />
        <code className="break-all font-mono text-sm">{path}</code>
        <span className="font-normal text-muted-foreground">— {op.summary}</span>
      </h3>
      <p className="text-sm">
        <span className="font-medium">Доступ:</span> {ACCESS_LABELS[op["x-access"]]}
      </p>
      <p className="text-sm text-muted-foreground">{op.description}</p>

      {op.parameters && op.parameters.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="mb-1 text-left text-xs font-medium text-muted-foreground">Параметры</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">Имя</th>
                <th scope="col" className="py-1 pr-3 font-medium">Где</th>
                <th scope="col" className="py-1 pr-3 font-medium">Описание</th>
                <th scope="col" className="py-1 font-medium">Пример</th>
              </tr>
            </thead>
            <tbody>
              {op.parameters.map((p) => (
                <tr key={`${p.in}-${p.name}`} className="border-b align-top last:border-0">
                  <td className="py-1 pr-3 font-mono text-xs">
                    {p.name}
                    {p.required ? <span className="text-destructive"> *</span> : null}
                  </td>
                  <td className="py-1 pr-3 text-xs">{p.in === "path" ? "путь" : p.in === "query" ? "строка запроса" : "заголовок"}</td>
                  <td className="py-1 pr-3">{p.description}</td>
                  <td className="py-1 font-mono text-xs">{p.example === undefined ? "—" : String(p.example)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requests.map((c) =>
        c.examples.map((ex) => (
          <details key={`${c.type}-${ex.summary}`} className="text-sm">
            <summary className="cursor-pointer py-1 font-medium">Пример запроса: {ex.summary}</summary>
            <JsonBlock value={ex.value} />
          </details>
        )),
      )}

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">Ответы</p>
        <ul className="flex flex-col gap-1">
          {Object.entries(op.responses).map(([status, res]) => {
            const shown = examplesOf(res.content);
            return (
              <li key={status}>
                <span className="font-mono text-xs font-semibold">{status}</span> — {res.description}
                {shown.map((c) =>
                  c.examples.map((ex) => (
                    <details key={`${status}-${ex.summary}`} className="ml-4">
                      <summary className="cursor-pointer py-1 text-muted-foreground">Пример ответа: {ex.summary}</summary>
                      <JsonBlock value={ex.value} />
                    </details>
                  )),
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export default function ApiDocsPage() {
  const operations = listOperations();
  const tags = OPENAPI.tags;
  return (
    <div className="surface-data flex flex-col gap-8 py-10">
      <div className="flex max-w-3xl flex-col gap-3">
        <h1 className="text-2xl font-semibold">API платформы</h1>
        <p className="text-muted-foreground">
          Методы для интеграций (ТЗ §3.8): каталог решений с источниками характеристик, нормативы модели, параметры объектов,
          расчёт сценариев без сохранения и проекты пользователя. Ответы — JSON, суммы — в рублях. Машиночитаемое описание в
          формате OpenAPI 3.1:{" "}
          <a className="tap-target font-mono text-sm underline" href="/api/v1/openapi.json">
            /api/v1/openapi.json
          </a>{" "}
          — его принимают генераторы клиентов, Swagger и Redoc.
        </p>
        <p className="text-sm text-muted-foreground">Версия API: {OPENAPI.info.version}.</p>
      </div>

      <section className="flex max-w-3xl flex-col gap-3">
        <h2 className="text-lg font-semibold">Доступ</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            <b>{ACCESS_LABELS.public}</b> — чтение каталога, нормативов и параметров, расчёт без сохранения.
          </li>
          <li>
            <b>{ACCESS_LABELS.user}</b> — cookie сессии, которую сайт выдаёт при входе: создание и чтение своих проектов.
            Чужой проект неотличим от несуществующего.
          </li>
          <li>
            <b>{ACCESS_LABELS.admin}</b> — вход на сайте под учётной записью с ролью администратора (роль проверяется по базе на
            каждый запрос) или заголовок <code className="font-mono text-xs">Authorization: Bearer &lt;ADMIN_API_TOKEN&gt;</code>{" "}
            для серверных интеграций. Токен задаётся переменной окружения сервера ADMIN_API_TOKEN, не короче{" "}
            {ADMIN_TOKEN_MIN_LENGTH} символов; не задан — вход по токену выключен.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Запросы с телом принимаются только с заголовком <code className="font-mono text-xs">Content-Type: application/json</code>.
          На стенде API работает через HTTPS, как и сайт.
        </p>
      </section>

      <section className="flex max-w-3xl flex-col gap-3">
        <h2 className="text-lg font-semibold">Ошибки и ограничения</h2>
        <p className="text-sm text-muted-foreground">
          Ошибка всегда имеет вид <code className="font-mono text-xs">{"{ \"error\": \"…\", \"details\": … }"}</code>: в error —
          что не так и как исправить, в details — ошибки по полям или позициям.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>400 — тело не разобрано как JSON; 413 — тело слишком большое; 415 — нет Content-Type: application/json.</li>
          <li>401 — нужен вход или токен; 403 — нужна роль администратора; 404 — не найдено.</li>
          <li>422 — данные не прошли проверку (неизвестный ключ, неверный тип, единица или диапазон); ничего не записано.</li>
          <li>
            429 — превышен лимит: расчёт — 60 запросов за 15 минут с одного IP, создание проектов — 30 за 15 минут на
            пользователя; заголовок Retry-After говорит, через сколько секунд повторить.
          </li>
          <li>503 — база данных временно недоступна.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Методы</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Метод</th>
                <th scope="col" className="py-2 pr-3 font-medium">Путь</th>
                <th scope="col" className="py-2 pr-3 font-medium">Доступ</th>
                <th scope="col" className="py-2 font-medium">Назначение</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((item) => (
                <tr key={anchorOf(item)} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3">
                    <MethodBadge method={item.method} />
                  </td>
                  <td className="py-2 pr-3">
                    <a className="tap-target break-all font-mono text-xs underline" href={`#${anchorOf(item)}`}>
                      {item.path}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-xs">{ACCESS_LABELS[item.op["x-access"]]}</td>
                  <td className="py-2">{item.op.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {tags.map((tag) => {
        const ops = operations.filter((o) => o.op.tags.includes(tag.name));
        if (ops.length === 0) return null;
        return (
          <section key={tag.name} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{tag.name}</h2>
              <p className="text-sm text-muted-foreground">{tag.description}</p>
            </div>
            {ops.map((item) => (
              <Operation key={anchorOf(item)} item={item} />
            ))}
          </section>
        );
      })}

      <p className="max-w-3xl text-sm text-muted-foreground">
        Результат расчёта является предварительной оценкой и требует верификации при обследовании объекта.
      </p>
    </div>
  );
}
