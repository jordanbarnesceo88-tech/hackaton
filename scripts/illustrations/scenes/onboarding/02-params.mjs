// 2. Параметры — портновский сантиметр: Xiaohei снимает мерки со склада, на складе — бирка размера.
import { Scene, INK, RED, measure } from "../../lib.mjs";

export default function draw() {
  const s = new Scene(2);
  s.raw(`<g transform="translate(0 -44)">`);
  s.line(250, 770, 1130, 770, { strokeWidth: 2.6, roughness: 1.1 });

  // склад
  s.poly([[500, 420], [770, 330], [1040, 420]]);
  s.rect(516, 420, 508, 350);
  for (const x0 of [586, 804]) {
    s.rect(x0, 580, 150, 190, { strokeWidth: 2.8 });
    for (let y = 600; y < 764; y += 20) s.line(x0 + 4, y, x0 + 146, y, { strokeWidth: 1.8, roughness: 0.6 });
  }
  s.hatch([[516, 420], [544, 420], [544, 770], [516, 770]], { hachureGap: 10 });

  // портновский сантиметр по «талии»
  const sag = (x) => 8 * Math.sin(((x - 480) / 554) * Math.PI);
  s.mask([[480, 492], [770, 500], [1034, 492], [1034, 520], [770, 528], [480, 520]]);
  s.curve([[480, 492], [770, 500], [1034, 492]], { strokeWidth: 2.8 });
  s.curve([[480, 520], [770, 528], [1034, 520]], { strokeWidth: 2.8 });
  for (let x = 560, i = 0; x < 1024; x += 22, i++) s.line(x, 492 + sag(x), x, 492 + sag(x) + (i % 5 === 0 ? 16 : 8), { strokeWidth: 1.8, roughness: 0.3 });
  s.curve([[1034, 492], [1046, 502], [1034, 520]], { strokeWidth: 2.8 });
  // свободный конец, Xiaohei держит его за металлический наконечник
  s.curve([[480, 518], [498, 560], [484, 600], [500, 634]], { strokeWidth: 2.8 });
  s.curve([[496, 520], [514, 562], [500, 600], [516, 634]], { strokeWidth: 2.8 });
  s.rect(494, 632, 26, 12, { strokeWidth: 2.4, fill: INK, fillStyle: "solid" });

  s.xiaohei({
    cx: 404, cy: 650, w: 100, h: 130, look: [11, -9], eyeGap: 16,
    legs: [[[384, 712], [382, 740], [380, 768]], [[424, 712], [427, 740], [430, 768]]],
    arms: [[[446, 612], [468, 566], [480, 510]], [[452, 662], [478, 652], [500, 642]]],
  });

  // бирка размера на правом свесе крыши, как на одежде
  const lines = ["площадь, м²", "спрос в сутки", "численность"];
  const tw = Math.max(...lines.map((l) => measure(l, 44))) + 60;
  const tx = 1100, ty = 500, th = 206;
  s.curve([[1040, 420], [1080, 454], [tx + 22, ty + 30]], { strokeWidth: 2.2 });
  s.raw(`<g transform="rotate(6 ${tx} ${ty})">`);
  s.mask([[tx, ty], [tx + tw, ty], [tx + tw, ty + th], [tx, ty + th]]);
  s.rect(tx, ty, tw, th, { strokeWidth: 3 });
  s.circle(tx + 22, ty + 30, 14, { strokeWidth: 2.4 });
  lines.forEach((l, i) => s.text(l, tx + 30, ty + 84 + i * 50, { size: 44 }));
  s.raw(`</g>`);

  s.text("снимаем мерки", 96, 450, { size: 64, color: RED, rotate: -4 });
  s.raw(`</g>`);
  return s;
}
