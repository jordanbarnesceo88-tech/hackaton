import { prisma } from "@/lib/db/client";
import { SIM_MODEL_VERSION, TZ_MODEL_VERSION } from "@/lib/tz/version";

/**
 * GET /api/health — проверка живости для Docker, CI и внешнего мониторинга (ТЗ §4.2.3, §3.8).
 *
 * 200 `{ ok: true, db: true, modelVersion, simModelVersion }` — приложение отвечает и база
 * доступна. 503 `{ ok: false, db: false, modelVersion, simModelVersion }` — база не ответила;
 * причина пишется только в лог сервера, наружу не уходит. Версии моделей — те же, что
 * сохраняются в проекте для воспроизводимости (ТЗ §3.1.5): по ним видно, какая сборка отвечает.
 *
 * Вход не нужен: ответ не содержит ни данных пользователей, ни данных проектов.
 */

// Только на запросе. Иначе Next вправе выполнить обработчик один раз при сборке и отдавать
// замороженный ответ, а при сборке Docker-образа базы нет — в образ попал бы вечный 503.
export const dynamic = "force-dynamic";

/** Сколько ждать ответа базы. Проверка Docker ждёт 5 с, поэтому 503 успевает прийти раньше. */
const DB_TIMEOUT_MS = 3000;

export async function GET() {
  const versions = { modelVersion: TZ_MODEL_VERSION, simModelVersion: SIM_MODEL_VERSION };
  const headers = { "Cache-Control": "no-store" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`база не ответила за ${DB_TIMEOUT_MS} мс`)),
          DB_TIMEOUT_MS,
        );
      }),
    ]);
    return Response.json({ ok: true, db: true, ...versions }, { headers });
  } catch (error) {
    console.error("GET /api/health: база недоступна", error);
    return Response.json({ ok: false, db: false, ...versions }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
