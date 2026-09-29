// 8. Отчёт — щит: Xiaohei закрывается отчётом от града вопросов «а цифры откуда?», вопросы отскакивают.
import { Scene, INK, RED, measure } from "../../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };

export default function draw() {
  const s = new Scene(8);
  s.line(200, 802, 1180, 802, { strokeWidth: 2.6, roughness: 1.1 });

  // реплика того, кто за кадром справа
  const q = "а цифры откуда?";
  const bw = measure(q, 52) + 90;
  s.ellipse(1560 - bw / 2, 250, bw, 150, { strokeWidth: 3, ...WHITE });
  s.poly([[1500, 300], [1600, 360], [1530, 282]], { strokeWidth: 3, ...WHITE });
  s.mask([[1502, 296], [1528, 285], [1520, 300]]);
  s.text(q, 1560 - bw / 2, 266, { size: 52, anchor: "middle" });

  // летящие вопросы со следами
  const qs = [
    { x: 1010, y: 410, size: 96, rot: -14 },
    { x: 1190, y: 530, size: 84, rot: 10 },
    { x: 960, y: 606, size: 72, rot: -8 },
  ];
  for (const { x, y, size, rot } of qs) {
    s.text("?", x, y, { size, rotate: rot, anchor: "middle" });
    for (const dy of [-44, -24]) s.line(x + 40, y + dy, x + 110, y + dy - 18, { strokeWidth: 2.2, strokeLineDash: [10, 8] });
  }
  // один отскакивает от отчёта: удар и рикошет
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    s.line(772 + 14 * Math.cos(a), 470 + 14 * Math.sin(a), 772 + 30 * Math.cos(a), 470 + 30 * Math.sin(a), { strokeWidth: 2.4, roughness: 0.3 });
  }
  s.curve([[790, 452], [830, 380], [880, 350]], { strokeWidth: 2.2, strokeLineDash: [10, 8] });
  s.text("?", 904, 352, { size: 76, rotate: 24, anchor: "middle" });

  // отчёт, выставленный как щит
  s.raw(`<g transform="rotate(-4 630 580)">`);
  s.poly([[500, 410], [728, 410], [764, 446], [764, 760], [500, 760]], { strokeWidth: 3.4, ...WHITE });
  s.lines([[728, 410], [728, 446], [764, 446]], { strokeWidth: 2.6 });
  s.text("отчёт", 530, 474, { size: 54 });
  for (const [i, h] of [[0, 60], [1, 96], [2, 132]]) s.rect(540 + i * 50, 640 - h, 34, h, { strokeWidth: 2.6, fill: INK, fillStyle: "hachure", hachureGap: 8, fillWeight: 1.4 });
  s.line(530, 642, 730, 642, { strokeWidth: 2.4 });
  s.curve([[530, 680], [580, 676], [630, 682], [680, 678], [730, 682]], { strokeWidth: 2, roughness: 0.8 });
  s.curve([[530, 706], [580, 702], [630, 708], [680, 704]], { strokeWidth: 2, roughness: 0.8 });
  s.text("¹ ² ³", 530, 744, { size: 30 });
  s.raw(`</g>`);

  // Xiaohei за ним, упирается
  s.xiaohei({
    cx: 420, cy: 660, w: 104, h: 134, look: [12, -4], eyeGap: 16, tilt: 6,
    legs: [[[398, 722], [388, 764], [376, 800]], [[440, 722], [446, 764], [452, 800]]],
    arms: [[[464, 620], [490, 590], [508, 560]], [[468, 666], [492, 660], [510, 650]]],
  });

  s.text("с источниками", 806, 740, { size: 56, color: RED, rotate: -3 });
  return s;
}
