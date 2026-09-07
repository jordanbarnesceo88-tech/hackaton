// Контраст пар токенов по WCAG 2.2, в обеих темах.
//
// Скрипт, а не тест: он проверяет решение дизайнера, а не поведение кода. Падение по нему —
// повод подумать над цветом, а не повод чинить сборку. Заведён ДО смены фона намеренно: смысл
// в том, чтобы поймать регрессию, а не подтвердить улучшение задним числом.
//
// Токены читаются из app/globals.css. Дублировать цвета рядом в sRGB — значит завести второй
// источник правды, который разъедется с первым молча; конвертация oklch -> sRGB определена
// однозначно, поэтому её проще написать, чем поддерживать копию.
//
// RELATIVE import-free: под tsx алиас "@/" не резолвится, поэтому путь к CSS — от корня репо.
import { readFileSync } from "node:fs";

type Rgb = [number, number, number];

/** oklch -> linear sRGB -> sRGB. Матрицы из спецификации CSS Color 4. */
function oklchToRgb(L: number, C: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  };
  return [enc(lin[0]!), enc(lin[1]!), enc(lin[2]!)];
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Токены одного блока globals.css: `--name: oklch(L C H);` */
function parseBlock(css: string, marker: string): Record<string, Rgb> {
  const from = css.indexOf(marker);
  if (from < 0) throw new Error(`Не найден блок токенов: ${marker}`);
  const body = css.slice(from, css.indexOf("\n}", from));
  const out: Record<string, Rgb> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) {
    out[m[1]!] = oklchToRgb(Number(m[2]), Number(m[3]), Number(m[4]));
  }
  return out;
}

// «Что на чём читают». 4.5:1 для текста, 3:1 для крупного текста и графических объектов.
const PAIRS: [fg: string, bg: string, min: number][] = [
  ["foreground", "background", 4.5],
  ["card-foreground", "card", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "background", 4.5],
  ["primary", "background", 3.0],
  ["primary-foreground", "primary", 4.5],
  ["destructive", "background", 4.5],
  // Графики проверяются на --card, а не на --background: сегодня токены --chart-* не
  // использует ни один компонент (полосы чувствительности рисуются на --primary), а когда
  // графики появятся, они окажутся внутри карточки — там живёт каждая панель. Зазор у них
  // узкий (3.07:1 при пороге 3.0 в светлой теме), поэтому поверхность под ними важно
  // называть точно, иначе тонирование фона страницы уронит проверку без причины.
  ["chart-1", "card", 3.0],
  ["chart-2", "card", 3.0],
  ["chart-3", "card", 3.0],
  ["chart-4", "card", 3.0],
  ["chart-5", "card", 3.0],
];

const css = readFileSync("app/globals.css", "utf8");
const themes: [string, string][] = [
  ["светлая", ":root {"],
  ["тёмная", ".dark {"],
];

let failed = 0;
for (const [label, marker] of themes) {
  const t = parseBlock(css, marker);
  console.log(`\n${label} тема`);
  for (const [fg, bg, min] of PAIRS) {
    // Токен, не найденный в блоке, — не повод пропустить пару. Цвет, определённый только в
    // одной теме, и есть классический баг нечитаемой страницы; считаем провалом.
    if (!t[fg] || !t[bg]) {
      failed++;
      console.log(`  FAIL  --${fg} или --${bg} не определён в этом блоке`);
      continue;
    }
    const r = ratio(t[fg]!, t[bg]!);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? "ok   " : "FAIL "} ${r.toFixed(2)}:1 (нужно ${min.toFixed(1)})  --${fg} на --${bg}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} пар(ы) ниже порога.`);
  process.exit(1);
}
console.log("\nВсе пары проходят в обеих темах.");
