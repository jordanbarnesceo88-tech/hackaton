// Процессы и спрос: иерархия как вложенные коробки — склад → процесс → тип решения → продукт.
// Xiaohei вынимает коробку «AMR» из коробки процесса; спрос считается на уровне процесса.
import { Scene, INK, RED, ORANGE } from "../../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };

/** Открытая коробка: передняя стенка, горловина и отогнутые клапаны. */
function box(s, x, y, w, h, flap = 0.32) {
  const d = Math.min(26, h * 0.16);
  s.poly([[x, y], [x + w, y], [x + w - d, y - d], [x + d, y - d]], { strokeWidth: 2.6, ...WHITE });
  s.poly([[x, y], [x - w * flap * 0.6, y - h * flap * 0.5], [x + d - w * flap * 0.2, y - d - h * flap * 0.55], [x + d, y - d]], { strokeWidth: 2.6, ...WHITE });
  s.poly([[x + w, y], [x + w + w * flap * 0.6, y - h * flap * 0.5], [x + w - d + w * flap * 0.2, y - d - h * flap * 0.55], [x + w - d, y - d]], { strokeWidth: 2.6, ...WHITE });
  s.rect(x, y, w, h, { strokeWidth: 3.2, ...WHITE });
}

export default function draw() {
  const s = new Scene(22);
  s.raw(`<g transform="translate(0 -80)">`);
  s.line(80, 760, 1500, 760, { strokeWidth: 2.6, roughness: 1.1 });

  box(s, 150, 470, 360, 290);
  s.text("склад", 330, 640, { size: 64, anchor: "middle" });
  box(s, 610, 580, 300, 180);
  s.text("перемещение", 760, 668, { size: 46, anchor: "middle" });
  s.text("паллет", 760, 716, { size: 46, anchor: "middle" });
  s.arrow([[470, 430], [540, 400], [610, 470]], { color: ORANGE, width: 3.2, head: 16 });

  // Xiaohei поднимает коробку «AMR» из коробки процесса
  box(s, 680, 400, 180, 124, 0.25);
  s.text("AMR", 770, 464, { size: 42, anchor: "middle" });
  s.text("паллетный", 770, 506, { size: 38, anchor: "middle" });
  for (const y of [548, 562]) s.line(760, y, 766, y + 10, { strokeWidth: 2 });
  s.xiaohei({
    cx: 972, cy: 664, w: 100, h: 128, look: [-12, -10], eyeGap: 15,
    legs: [[[952, 724], [950, 742], [948, 758]], [[992, 724], [995, 742], [998, 758]]],
    arms: [[[926, 640], [896, 590], [862, 520]], [[930, 680], [900, 600], [862, 490]]],
  });

  // самая маленькая коробка — продукт, из неё выглядывает робот
  s.arrow([[880, 380], [1010, 330], [1150, 560]], { color: ORANGE, width: 3.2, head: 16 });
  box(s, 1110, 660, 150, 100, 0.2);
  s.text("H1500", 1185, 728, { size: 40, anchor: "middle" });
  s.rect(1150, 612, 70, 34, { strokeWidth: 2.8, ...WHITE });
  s.circle(1185, 629, 12, { fill: INK, fillStyle: "solid", strokeWidth: 1.6 });
  s.line(1185, 612, 1185, 594, { strokeWidth: 2.4 });
  s.circle(1185, 590, 9, { strokeWidth: 2 });

  s.text("спрос считается здесь", 760, 842, { size: 52, color: RED, anchor: "middle", rotate: -2 });
  s.arrow([[760, 808], [760, 790], [760, 772]], { color: RED, width: 3, head: 14 });
  s.raw(`</g>`);
  return s;
}
