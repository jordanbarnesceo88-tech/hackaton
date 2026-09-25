import type { SimEngineState } from "@/lib/sim/state";
import { SIM_MODEL_VERSION, type SimLayout, type SimSummaryStored } from "@/lib/sim/types";
import { LEGEND_ITEMS, SCENE_BG, SCENE_FONT_FAMILY, drawLegendSwatch, drawScene } from "./draw-scene";
import { kpiLines, verdictBadge, type VerdictTone } from "./kpi-text";

/**
 * Выгрузка визуализации в PNG (ТЗ §3.7.4 — экспорт или сохранение визуализации). Картинка
 * самодостаточна: схема, легенда, показатели, сценарий, зерно генератора, модель, дата и
 * оговорка о предварительной оценке — её можно вставить в отчёт или письмо без пояснений.
 *
 * Скачивание: canvas.toBlob → URL.createObjectURL → <a download> → revokeObjectURL. Картинку не
 * показываем через <img src="blob:…">: политика CSP страницы (next.config.ts) такие адреса
 * запрещает, а ссылка на скачивание под неё не попадает.
 */

/** Оговорка в подвале PNG. */
export const PNG_DISCLAIMER = "Предварительная оценка, требует обследования объекта.";

/** Пояснение модели в подвале PNG — то же, что под схемой на экране. */
export const PNG_MODEL_NOTE =
  "Упрощённая имитация: маршруты по сетке проходов, без разъездов роботов; времена погрузки — оценка.";

/**
 * Подпись под схемой на экране: пояснение модели и оговорка — те же строки, что в подвале PNG.
 * Лежит здесь, а не в клиентском модуле, чтобы её мог импортировать и серверный компонент
 * (отчёт): из модуля с 'use client' сервер получил бы ссылку на клиент, а не текст.
 */
export const SIM_FOOTER = `${PNG_MODEL_NOTE} ${PNG_DISCLAIMER}`;

const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Наибольшая длина части имени файла из названия сценария. 64 символа вмещают подпись варианта
 * вместе с числом роботов («pokupka-ronavi-h1500-park-po-norme-organizatora-3» — 50).
 */
const MAX_SLUG = 64;

/**
 * Латинская часть имени файла из русского названия: транслитерация, нижний регистр, всё прочее —
 * дефисы, без дефисов по краям, не длиннее 64 символов (обрезается по дефису). Пустой результат —
 * «scenariy».
 */
export function slugifyRu(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) {
    const t = TRANSLIT[ch];
    if (t !== undefined) out += t;
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (out.length > MAX_SLUG) {
    const cut = out.slice(0, MAX_SLUG);
    const lastDash = cut.lastIndexOf("-");
    out = (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-$/, "");
  }
  return out || "scenariy";
}

/** Имя файла PNG: «imitaciya-{сценарий латиницей}-seed{n}.png». */
export function simPngFilename(scenarioName: string, seed: number): string {
  const n = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  return `imitaciya-${slugifyRu(scenarioName)}-seed${n}.png`;
}

/** Сведения о прогоне для заголовка и подвала PNG. */
export type SimPngMeta = {
  /** Название сценария и парка («Покупка — Ronavi H1500 — парк по расчёту (11)»). */
  scenarioName: string;
  seed: number;
  /** Дата и время выгрузки, уже отформатированные. */
  dateText: string;
  /** Часы модели на кадре («Время имитации: 02:15 · окончен»); без них не пишется. */
  clockText?: string;
  /** Кадр посреди прогона: показатели — по пройденной части пикового окна. */
  partial?: boolean;
  /**
   * Итог полного прогона — для строки вердикта, когда `summary` посчитана посреди прогона
   * (вердикт по части окна был бы преждевременным). По умолчанию вердикт берётся из `summary`.
   */
  finalSummary?: SimSummaryStored;
};

/** Цвета PNG вне схемы: светлый лист для печати. */
const PAGE_BG = "#ffffff";
const TEXT = "#0f172a";
const MUTED = "#475569";
const TONE_COLORS: Readonly<Record<VerdictTone, string>> = {
  confirmed: "#15803d",
  oversized: "#a16207",
  "not-confirmed": "#b91c1c",
  "not-supported": "#475569",
};

/** Ширина листа PNG в логических пикселях; буфер — вдвое больше (выгрузка 2×). */
const PAGE_W = 1200;
const PAD = 24;
const PNG_DPR = 2;
/** Колонок в легенде PNG: при трёх самые длинные подписи помещаются без сжатия. */
const LEGEND_COLS = 3;

function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${SCENE_FONT_FAMILY}`;
}

/** Перенос текста по словам в пределах `maxW`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Скачивание Blob под именем `filename` через временную ссылку. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Отзыв адреса откладывается: часть браузеров начинает чтение Blob после возврата из click().
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Собирает PNG 2× со схемой, легендой, показателями, сценарием, зерном, датой и оговоркой и
 * отдаёт его на скачивание. Возвращает имя файла; при сбое браузера — ошибка с понятным текстом.
 */
export async function exportSimPng(
  layout: SimLayout,
  state: SimEngineState | null,
  summary: SimSummaryStored,
  meta: SimPngMeta,
): Promise<string> {
  const filename = simPngFilename(meta.scenarioName, meta.seed);
  const canvas = document.createElement("canvas");
  const measure = canvas.getContext("2d");
  if (!measure) throw new Error("браузер не дал канву для сборки PNG");

  const innerW = PAGE_W - 2 * PAD;
  const sceneH = Math.round(innerW / 2);
  const lines = kpiLines(summary);
  const badge = verdictBadge(meta.finalSummary ?? summary);

  measure.font = font(14);
  const footLines = [
    ...wrap(measure, PNG_MODEL_NOTE, innerW),
    ...wrap(measure, PNG_DISCLAIMER, innerW),
  ];
  const kpiRows = Math.ceil(lines.length / 2);
  const legendRows = Math.ceil(LEGEND_ITEMS.length / LEGEND_COLS);

  const headerH = 70;
  const legendH = legendRows * 26 + 16;
  const kpiH = 16 + 30 + kpiRows * 24 + (meta.partial ? 22 : 0);
  const footH = 16 + footLines.length * 20 + 12;
  const pageH = headerH + sceneH + legendH + kpiH + footH;

  canvas.width = PAGE_W * PNG_DPR;
  canvas.height = pageH * PNG_DPR;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("браузер не дал канву для сборки PNG");
  ctx.setTransform(PNG_DPR, 0, 0, PNG_DPR, 0, 0);
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, PAGE_W, pageH);

  // Заголовок: сценарий и параметры прогона.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = TEXT;
  ctx.font = font(20, 700);
  ctx.fillText(`Имитация склада: ${meta.scenarioName}`, PAD, 32, innerW);
  ctx.fillStyle = MUTED;
  ctx.font = font(14);
  const sub = [
    `seed ${meta.seed}`,
    `модель ${summary.simModelVersion || SIM_MODEL_VERSION}`,
    meta.clockText,
    `выгружено ${meta.dateText}`,
  ].filter(Boolean);
  ctx.fillText(sub.join(" · "), PAD, 56, innerW);

  // Схема — та же функция, что на экране.
  let y = headerH;
  drawScene(ctx, layout, state, { W: innerW, H: sceneH, dpr: PNG_DPR, scale: 1.4, labels: true, x: PAD, y });
  y += sceneH;

  // Легенда на тёмной полосе: голубые и жёлтые значки на белом не читаются.
  ctx.fillStyle = SCENE_BG;
  ctx.fillRect(PAD, y, innerW, legendH - 8);
  const colW = innerW / LEGEND_COLS;
  ctx.font = font(13);
  ctx.textBaseline = "middle";
  LEGEND_ITEMS.forEach((item, i) => {
    const col = i % LEGEND_COLS;
    const row = Math.floor(i / LEGEND_COLS);
    const cx = PAD + col * colW + 18;
    const cy = y + 8 + row * 26 + 13;
    drawLegendSwatch(ctx, item, cx, cy, 12);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = font(13);
    ctx.fillText(item.label, cx + 18, cy, colW - 40);
  });
  y += legendH;

  // Вердикт и показатели в две колонки.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TONE_COLORS[badge.tone];
  ctx.font = font(17, 700);
  ctx.fillText(badge.text, PAD, y + 24, innerW);
  ctx.fillStyle = TEXT;
  ctx.font = font(15);
  lines.forEach((line, i) => {
    const col = i < kpiRows ? 0 : 1;
    const row = col === 0 ? i : i - kpiRows;
    ctx.fillText(line, PAD + col * (innerW / 2), y + 54 + row * 24, innerW / 2 - 12);
  });
  if (meta.partial) {
    ctx.fillStyle = MUTED;
    ctx.font = font(13);
    ctx.fillText(
      "Кадр посреди прогона: показатели — по пройденной части пикового окна, вердикт и узкое место — по полному прогону.",
      PAD,
      y + 54 + kpiRows * 24,
      innerW,
    );
  }
  y += kpiH;

  // Подвал: допущения модели и оговорка.
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y + 4);
  ctx.lineTo(PAGE_W - PAD, y + 4);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.font = font(14);
  footLines.forEach((line, i) => ctx.fillText(line, PAD, y + 26 + i * 20, innerW));

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("браузер не смог собрать PNG — попробуйте ещё раз или уменьшите масштаб страницы");
  download(blob, filename);
  return filename;
}
