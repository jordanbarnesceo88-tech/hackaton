// 7. Имитация — настольная игра: Xiaohei двигает фишки-роботы по плану склада, цифры записаны рядом в блокноте.
import { Scene, INK, RED, BLUE, ORANGE, measure } from "../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };
const TL = [440, 372], TR = [1160, 372], BL = [320, 652], BR = [1280, 652];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const P = (u, v) => lerp(lerp(TL, TR, u), lerp(BL, BR, u), v);

export default function draw() {
  const s = new Scene(7);
  s.line(250, 842, 1150, 842, { strokeWidth: 2.6, roughness: 1.1 });

  // доска-план склада с небольшой толщиной
  s.poly([TL, TR, BR, BL], { strokeWidth: 3.4, ...WHITE });
  s.lines([BL, [BL[0], BL[1] + 16], [BR[0], BR[1] + 16], BR], { strokeWidth: 3 });
  // ряды стеллажей
  for (const v of [0.12, 0.34, 0.56, 0.78]) {
    s.poly([P(0.06, v), P(0.66, v), P(0.66, v + 0.08), P(0.06, v + 0.08)], { strokeWidth: 2.6 });
    for (let u = 0.12; u < 0.66; u += 0.08) s.line(...P(u, v), ...P(u, v + 0.08), { strokeWidth: 1.6, roughness: 0.3 });
  }
  // зона погрузки
  s.poly([P(0.8, 0.08), P(0.95, 0.08), P(0.95, 0.92), P(0.8, 0.92)], { strokeWidth: 2.4 });
  s.hatch([P(0.8, 0.08), P(0.95, 0.08), P(0.95, 0.92), P(0.8, 0.92)], { hachureGap: 14, hachureAngle: 60 });
  // маршрут: из зоны погрузки по одному проходу и обратно по соседнему
  s.arrow([P(0.8, 0.49), P(0.5, 0.49), P(0.16, 0.49), P(0.1, 0.38), P(0.16, 0.27), P(0.5, 0.27), P(0.72, 0.27)],
    { color: ORANGE, width: 3.6, head: 18, o: { strokeLineDash: [16, 11] } });
  // фишки-роботы
  for (const [u, v] of [[0.55, 0.27], [0.3, 0.71], [0.36, 0.49]]) {
    const [x, y] = P(u, v);
    s.rect(x - 20, y - 14, 40, 28, { strokeWidth: 2.8, ...WHITE });
    s.circle(x, y, 9, { fill: INK, fillStyle: "solid", strokeWidth: 1.4 });
  }

  // Xiaohei тянется к доске и толкает фишку пальцем
  const [px, py] = P(0.36, 0.49);
  s.xiaohei({
    cx: 540, cy: 718, w: 104, h: 132, look: [12, -10], eyeGap: 16, tilt: 8,
    legs: [[[518, 780], [514, 812], [510, 840]], [[558, 780], [562, 812], [566, 840]]],
    arms: [[[586, 684], [640, 610], [px - 26, py + 10]], [[494, 700], [470, 740], [474, 770]]],
  });

  // блокнот с настоящими цифрами — рядом с доской
  const nw = measure("загрузка 78%", 44) + 50, nx = 1540 - nw;
  s.raw(`<g transform="rotate(4 ${nx + nw / 2} 330)">`);
  s.rect(nx, 250, nw, 180, { strokeWidth: 3, ...WHITE });
  for (let x = nx + 20; x < nx + nw - 10; x += 26) s.circle(x, 250, 12, { strokeWidth: 2 });
  s.text("3 робота", nx + 24, 326, { size: 44 });
  s.text("загрузка 78%", nx + 24, 390, { size: 44 });
  s.raw(`</g>`);
  s.text("цифры — рядом", 1550, 196, { size: 58, color: RED, rotate: -3, anchor: "end" });
  s.text("для наглядности", 470, 330, { size: 48, color: BLUE, rotate: -2 });
  return s;
}
