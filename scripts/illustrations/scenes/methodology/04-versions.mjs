// Версии: расчёт закатан в банку, на этикетке — версия модели, имитации и данных. На полке —
// старая банка: данные с тех пор изменились, и проект предлагает пересчитать.
import { Scene, INK, RED, BLUE, ORANGE } from "../../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };
const rounded = (x, y, w, h, r) =>
  `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;

function jar(s, x, y, w, h, lidH) {
  const neck = w * 0.12;
  s.path(rounded(x, y + lidH + 30, w, h - lidH - 30, 34), { strokeWidth: 3.2, ...WHITE });
  s.poly([[x + 18, y + lidH + 32], [x + neck, y + lidH + 4], [x + w - neck, y + lidH + 4], [x + w - 18, y + lidH + 32]], { strokeWidth: 2.6, ...WHITE });
  s.rect(x + neck - 8, y, w - 2 * neck + 16, lidH, { strokeWidth: 3.2, ...WHITE });
  for (let gx = x + neck + 10; gx < x + w - neck; gx += 18) s.line(gx, y + 6, gx, y + lidH - 6, { strokeWidth: 1.8, roughness: 0.3 });
}

export default function draw() {
  const s = new Scene(24);
  s.line(200, 780, 940, 780, { strokeWidth: 2.6, roughness: 1.1 });

  // большая банка со снимком расчёта
  jar(s, 540, 318, 330, 462, 52);
  s.curve([[566, 440], [560, 520], [566, 600]], { strokeWidth: 2.2 });
  s.raw(`<g transform="rotate(7 700 480)">`);
  s.rect(610, 410, 190, 150, { strokeWidth: 2.6, ...WHITE });
  for (const [i, h] of [[0, 30], [1, 50], [2, 70]].map(([i, h]) => [i, h])) s.rect(630 + i * 30, 540 - h, 20, h, { strokeWidth: 2, fill: INK, fillStyle: "hachure", hachureGap: 7, fillWeight: 1.2 });
  s.curve([[726, 450], [750, 446], [776, 452]], { strokeWidth: 2 });
  s.curve([[726, 476], [750, 472], [776, 478]], { strokeWidth: 2 });
  s.curve([[726, 502], [750, 498], [776, 504]], { strokeWidth: 2 });
  s.raw(`</g>`);
  s.rect(580, 590, 250, 150, { strokeWidth: 2.8, ...WHITE });
  s.text("tz-1.0.0", 705, 634, { size: 38, anchor: "middle" });
  s.text("sim-1.0.0", 705, 677, { size: 38, anchor: "middle" });
  s.text("данные #3fa9", 705, 720, { size: 38, anchor: "middle" });

  // Xiaohei на ящиках закручивает крышку
  s.rect(318, 600, 130, 90, { strokeWidth: 3, ...WHITE });
  s.line(322, 686, 444, 604, { strokeWidth: 2.2 });
  s.rect(310, 690, 146, 90, { strokeWidth: 3, ...WHITE });
  s.line(314, 776, 452, 694, { strokeWidth: 2.2 });
  s.xiaohei({
    cx: 386, cy: 526, w: 100, h: 128, look: [12, -10], eyeGap: 15,
    legs: [[[366, 586], [365, 594], [364, 600]], [[406, 586], [407, 594], [408, 600]]],
    arms: [[[430, 498], [500, 420], [584, 340]], [[434, 532], [510, 450], [586, 362]]],
  });
  s.arrow([[600, 300], [700, 262], [812, 296]], { color: ORANGE, width: 3.4, head: 16 });

  // полка со старой банкой: данные изменились
  s.rect(1000, 560, 470, 18, { strokeWidth: 3, ...WHITE });
  for (const x of [1060, 1410]) s.lines([[x, 578], [x, 640], [x - 40, 578]], { strokeWidth: 2.6 });
  jar(s, 1040, 360, 150, 200, 30);
  s.curve([[1070, 470], [1115, 466], [1160, 472]], { strokeWidth: 2 });
  s.curve([[1070, 496], [1115, 492], [1160, 498]], { strokeWidth: 2 });
  jar(s, 1260, 360, 150, 200, 30);
  s.curve([[1290, 470], [1335, 466], [1380, 472]], { strokeWidth: 2 });
  s.circle(1335, 506, 50, { stroke: RED, strokeWidth: 3 });
  s.text("?", 1335, 524, { size: 50, color: RED, anchor: "middle" });

  s.text("снимок расчёта", 900, 250, { size: 52, color: BLUE });
  s.arrow([[950, 262], [900, 330], [840, 400]], { color: BLUE, width: 2.8, head: 16 });
  s.text("пересчитать?", 1335, 320, { size: 56, color: RED, anchor: "middle", rotate: -3 });
  return s;
}
