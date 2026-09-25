import type { NextRequest } from "next/server";
import { getParamDefinitions } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/client";
import { FACILITY_LABELS, paramsTemplateCsv } from "@/lib/tz/params/template";
import { writeParamsTemplateXlsx } from "@/lib/tz/params/xlsx";

/**
 * GET /api/templates/{facility}?format=xlsx|csv — шаблон загрузки параметров объекта
 * (ТЗ §3.2.3: «загрузка данных из Excel/CSV по шаблону»; §3.2.5: значения по умолчанию и
 * источник каждого норматива видны прямо в шаблоне).
 *
 * `facility` — warehouse, airport или medical. Описания параметров берутся из
 * администрируемой таблицы ParamDefinition, поэтому шаблон всегда совпадает с тем, что
 * проверяет загрузка (lib/projects/import-action.ts). `format=xlsx` — книга Excel с листами
 * «Параметры» и «Как заполнить»; иначе — CSV для русского Excel (BOM, «;», десятичная запятая).
 *
 * Вход не нужен: шаблон содержит только описания параметров и демо-значения организатора, а
 * гость тоже может загрузить файл в демо-расчёт (ТЗ §3.1.2).
 */

// Шаблон строится на запросе из БД: при сборке базы нет, а администратор может менять описания.
export const dynamic = "force-dynamic";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Текстовый ответ об ошибке по-русски: что не так и что сделать. */
function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ facility: string }> }) {
  const { facility } = await params;
  // hasOwn, а не FACILITY_LABELS[facility]: иначе «constructor» и прочие ключи прототипа
  // прошли бы проверку.
  const label = Object.hasOwn(FACILITY_LABELS, facility) ? FACILITY_LABELS[facility] : undefined;
  if (!label) {
    return textError(
      "Шаблон не найден: неизвестный тип объекта. Доступны /api/templates/warehouse, /api/templates/airport и /api/templates/medical",
      404,
    );
  }
  const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  let body: Uint8Array;
  try {
    const defs = await getParamDefinitions(prisma, facility);
    if (defs.length === 0) {
      return textError(
        `Параметры объекта «${label}» ещё не загружены в базу. Администратору: выполните npm run db:seed и повторите`,
        503,
      );
    }
    body = format === "xlsx" ? await writeParamsTemplateXlsx(defs) : new TextEncoder().encode(paramsTemplateCsv(defs));
  } catch (e) {
    console.error(`GET /api/templates/${facility}`, e);
    return textError("Не удалось собрать шаблон: база данных временно недоступна. Повторите через минуту", 503);
  }

  // Имя файла не в ASCII — только в форме RFC 5987 (filename*): кириллица в обычном значении
  // заголовка роняет ответ (ByteString). ASCII-имя — запасное для старых клиентов.
  const fileName = `Шаблон параметров — ${label}.${format}`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "xlsx" ? XLSX_TYPE : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="params-${facility}.${format}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
