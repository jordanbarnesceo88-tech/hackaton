// 4. Сравнение — опознание: три робота-варианта у одной ростовой стены, Xiaohei заносит их в одну таблицу.
import { Scene, INK, RED, BLUE } from "../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };

export default function draw() {
  const s = new Scene(4);
  s.line(250, 782, 1350, 782, { strokeWidth: 2.6, roughness: 1.1 });
  // ростовая стена: одна шкала за всеми
  for (const [i, y] of [300, 380, 460, 540, 620, 700].entries()) {
    s.line(300, y, 1010, y, { strokeWidth: 1.8, roughness: 1.2, bowing: 1.2 });
    if (i % 2 === 0) s.text(String(6 - i), 282, y + 10, { size: 32, anchor: "middle" });
  }

  // A: низкий колёсный робот с куполом лидара
  s.arc(440, 690, 52, 46, Math.PI, Math.PI * 2, { strokeWidth: 3, ...WHITE });
  s.rect(360, 690, 160, 72, { strokeWidth: 3.2, ...WHITE });
  s.circle(392, 768, 26, { strokeWidth: 2.8, ...WHITE });
  s.circle(488, 768, 26, { strokeWidth: 2.8, ...WHITE });
  // B: робот-мачта с головой-сенсором
  s.rect(638, 424, 44, 278, { strokeWidth: 3, ...WHITE });
  for (const y of [480, 560, 640]) s.line(638, y, 682, y, { strokeWidth: 2 });
  s.rect(616, 376, 88, 50, { strokeWidth: 3.2, ...WHITE });
  s.circle(660, 401, 16, { fill: INK, fillStyle: "solid", strokeWidth: 2 });
  s.rect(600, 700, 120, 62, { strokeWidth: 3.2, ...WHITE });
  s.circle(624, 768, 22, { strokeWidth: 2.8, ...WHITE });
  s.circle(696, 768, 22, { strokeWidth: 2.8, ...WHITE });
  // C: манипулятор на тумбе
  s.lines([[885, 694], [880, 560], [966, 476]], { strokeWidth: 16, roughness: 0.3, stroke: INK });
  s.lines([[885, 694], [880, 560], [966, 476]], { strokeWidth: 9, roughness: 0.3, stroke: "#fff" });
  s.circle(880, 560, 28, { strokeWidth: 2.8, ...WHITE });
  s.circle(966, 476, 24, { strokeWidth: 2.8, ...WHITE });
  s.lines([[976, 458], [1000, 446], [1008, 462]], { strokeWidth: 3 });
  s.lines([[984, 490], [1008, 494], [1006, 510]], { strokeWidth: 3 });
  s.rect(836, 690, 96, 90, { strokeWidth: 3.2, ...WHITE });

  // номерные таблички на одной высоте
  for (const [t, x] of [["A", 408], ["B", 628], ["C", 852]]) {
    s.rect(x, 712, 64, 44, { strokeWidth: 2.6, ...WHITE });
    s.text(t, x + 32, 748, { size: 40, anchor: "middle" });
  }

  // Xiaohei с планшетом: одна таблица на всех троих
  s.xiaohei({
    cx: 1170, cy: 690, w: 100, h: 128, look: [-12, -2], eyeGap: 15,
    legs: [[[1150, 750], [1148, 768], [1146, 780]], [[1190, 750], [1193, 768], [1196, 780]]],
    arms: [[[1124, 676], [1106, 660], [1094, 642]], [[1214, 690], [1236, 660], [1246, 632]]],
  });
  s.raw(`<g transform="rotate(-6 1060 600)">`);
  s.rect(1010, 540, 110, 140, { strokeWidth: 3, ...WHITE });
  s.rect(1046, 530, 38, 16, { strokeWidth: 2.4, fill: INK, fillStyle: "solid" });
  for (const y of [580, 614, 648]) s.line(1022, y, 1108, y, { strokeWidth: 1.8 });
  for (const x of [1050, 1080]) s.line(x, 560, x, 668, { strokeWidth: 1.8 });
  s.raw(`</g>`);
  s.line(1244, 636, 1262, 600, { strokeWidth: 6, roughness: 0.2 });

  s.text("одной меркой", 470, 262, { size: 68, color: RED, rotate: -3 });
  s.text("окупаемость · NPV · парк", 1270, 430, { size: 46, color: BLUE, anchor: "middle" });
  return s;
}
