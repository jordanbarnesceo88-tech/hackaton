import { LEVER_LABELS } from "./assumption-labels";
import { formatCost } from "@/lib/format/currency";
import type { SensitivityBar } from "@/lib/economics/sensitivity";

const ROW_H = 30;
const BAR_H = 16;
// Место под самую длинную подпись. 210 не хватало: «Срок службы техники (лет) (±1 год)»
// занимает 202 пикселя и при отступе 10 уходила за левый край viewBox на два пикселя —
// незаметно на глаз и очевидно при измерении. Проверяется обеими сторонами, а не только правой.
const PAD_LEFT = 240;
// Место под значение справа от полосы. 150 не хватало: суммы идут в формате
// «87 596 062 ₽ (US$973,290)» — около двадцати пяти знаков, и хвост обрезался ровно у самой
// длинной полосы, то есть у самого важного фактора.
const PAD_RIGHT = 250;
const PAD_TOP = 22; // место под подпись нулевой линии
const PAD_BOTTOM = 8;
const PLOT_W = 430;

/**
 * Торнадо-диаграмма чувствительности NPV.
 *
 * SVG руками, без библиотеки: одна диаграмма не окупает зависимость, а CSP разрешает скрипты
 * не с любого CDN. Цвета берутся из токенов темы — захардкоженный цвет сломал бы тёмную тему
 * и печать, а палитра `--chart-1..5` уже проверена на цветовую слепоту и контраст.
 */
export function TornadoChart({
  bars,
  usdToRub,
}: {
  bars: SensitivityBar[];
  usdToRub: number;
}) {
  if (bars.length === 0) return null;

  // ОДНА шкала на всю диаграмму. Масштабировать каждую строку от собственного максимума —
  // значит превратить торнадо в набор одинаковых полос, то есть ровно в то, чего диаграмма
  // делать не должна: она существует, чтобы показать, что один фактор сильнее другого.
  const maxSwing = Math.max(...bars.map((b) => b.swing), 1);
  const x = (v: number) => PAD_LEFT + (v / maxSwing) * PLOT_W;

  const width = PAD_LEFT + PLOT_W + PAD_RIGHT;
  const height = PAD_TOP + PAD_BOTTOM + bars.length * ROW_H;

  const top3 = bars.slice(0, 3).map((b) => LEVER_LABELS[b.key]).join(", ");

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        className="h-auto max-w-full"
        role="img"
        // SC 1.1.1: диаграмма без текстового эквивалента — информация, потерянная для
        // скринридера. Порядок и есть содержание: что влияет сильнее всего.
        aria-label={`Чувствительность NPV к допущениям. Сильнее всего влияют: ${top3}.`}
      >
        {/* Нулевая линия. Без неё торнадо нечитаем: не видно, от чего отложены полосы. */}
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP - 6}
          x2={PAD_LEFT}
          y2={height - PAD_BOTTOM}
          stroke="var(--border)"
          strokeWidth={1}
        />
        <text x={PAD_LEFT} y={PAD_TOP - 12} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
          0
        </text>

        {bars.map((b, i) => {
          const y = PAD_TOP + i * ROW_H;
          // Подпись называет ПОДСТАВЛЕННЫЕ значения, а не запрошенную долю. «±25 %» врало в обе
          // стороны: нижнее плечо зажималось границей допущения, верхнее не зажималось вовсе,
          // и у рычага на своём максимуме размах выходил ровно вдвое больше настоящего.
          const num = (n: number) =>
            n.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
          const clamped = b.clampedLow || b.clampedHigh;
          const range = `${num(b.lowValue)} → ${num(b.highValue)}`;
          return (
            <g key={b.key}>
              {/* <title> — и подсказка мышью, и доступное имя группы. */}
              <title>{`${LEVER_LABELS[b.key]} (${range}${
                clamped ? ", плечо упёрлось в границу допущения" : ""
              }): размах ${formatCost(b.swing, usdToRub)}`}</title>
              <text
                x={PAD_LEFT - 10}
                y={y + BAR_H - 3}
                textAnchor="end"
                fontSize={12}
                fill="var(--muted-foreground)"
              >
                {LEVER_LABELS[b.key]}
                {b.kind === "whole-year" ? " (±1 год)" : ""}
                {clamped ? " *" : ""}
                {b.swing === 0 ? " — не двигает" : ""}
              </text>
              <rect
                x={PAD_LEFT}
                y={y}
                width={Math.max(1, x(b.swing) - PAD_LEFT)}
                height={BAR_H}
                rx={2}
                // Рычаг, который при этих параметрах ничего не двигает, рисуется погашенным,
                // а НЕ выбрасывается: молча исчезающий столбец уже был багом — человек видел
                // торнадо без рычага, которым только что двигал.
                //
                // Пометка осмысленна только теперь. Пока возмущение нуля само равнялось нулю,
                // «размах 0» означал и «рычаг не двигает», и «мы не умеем его сдвинуть», и
                // погасить второе было бы враньём: у discountRate = 0 настоящий размах
                // 41 609 ₽, а не ноль.
                fill={b.swing === 0 ? "var(--muted)" : `var(--chart-${(i % 5) + 1})`}
              />
              <text
                x={x(b.swing) + 10}
                y={y + BAR_H - 3}
                fontSize={12}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {formatCost(b.swing, usdToRub)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
