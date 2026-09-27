// Нормативы и допущения: у каждого норматива — диапазон. Xiaohei толкает ползунок дальше
// «макс», но ограничитель не пускает: значение прижимается к границе.
import { Scene, RED, BLUE, measure } from "../../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };

export default function draw() {
  const s = new Scene(21);
  s.raw(`<g transform="translate(0 -70)">`);
  s.line(150, 640, 1450, 640, { strokeWidth: 2.6, roughness: 1.1 });

  // направляющая с делениями
  s.rect(220, 612, 1160, 28, { strokeWidth: 3, ...WHITE });
  for (let x = 240, i = 0; x < 1370; x += 30, i++) s.line(x, 612, x, 612 + (i % 5 === 0 ? 18 : 9), { strokeWidth: 1.8, roughness: 0.3 });
  // ограничители
  for (const [x, t] of [[360, "мин"], [1160, "макс"]]) {
    s.rect(x, 452, 40, 160, { strokeWidth: 3.2, ...WHITE });
    s.hatch([[x + 3, 455], [x + 37, 455], [x + 37, 609], [x + 3, 609]], { hachureGap: 9 });
    s.text(t, x + 20, 430, { size: 48, anchor: "middle" });
  }
  // желаемое значение за границей — пунктиром
  s.rect(1214, 482, 130, 130, { strokeWidth: 2.4, strokeLineDash: [12, 10], roughness: 0.6 });
  s.text("?", 1279, 574, { size: 84, anchor: "middle" });
  // ползунок, упёршийся в «макс»
  s.rect(1030, 482, 130, 130, { strokeWidth: 3.4, ...WHITE });
  for (const x of [1066, 1095, 1124]) s.line(x, 506, x, 588, { strokeWidth: 2.4 });
  s.line(1095, 612, 1095, 626, { strokeWidth: 3.2 });
  // бирка «источник» на ползунке
  s.curve([[1095, 482], [1080, 440], [1052, 404]], { strokeWidth: 2 });
  const tw = measure("источник", 42) + 56;
  s.raw(`<g transform="rotate(-6 ${1052 - tw / 2} 360)">`);
  s.rect(1052 - tw + 20, 318, tw, 92, { strokeWidth: 2.8, ...WHITE });
  s.circle(1052 - 4, 340, 12, { strokeWidth: 2 });
  s.text("источник", 1052 - tw + 44, 366, { size: 42 });
  s.curve([[1052 - tw + 44, 390], [1052 - tw + 80, 386], [1052 - tw + 116, 392], [1052 - tw + 152, 387]], { strokeWidth: 2, roughness: 0.8 });
  s.raw(`</g>`);

  // Xiaohei упирается в ползунок
  s.xiaohei({
    cx: 962, cy: 560, w: 100, h: 128, look: [12, -2], eyeGap: 15, tilt: 14,
    legs: [[[942, 616], [918, 630], [896, 640]], [[982, 618], [990, 630], [994, 640]]],
    arms: [[[1004, 532], [1018, 530], [1028, 528]], [[1008, 572], [1020, 572], [1028, 572]]],
  });
  for (const y of [520, 548, 576]) s.line(846, y, 882, y, { strokeWidth: 2.4 });

  s.text("дальше нельзя", 1392, 452, { size: 56, color: RED, anchor: "middle", rotate: -3 });
  // диапазон — скобкой под направляющей
  s.lines([[380, 674], [380, 694], [1180, 694], [1180, 674]], { stroke: BLUE, strokeWidth: 3 });
  s.text("диапазон", 780, 760, { size: 56, color: BLUE, anchor: "middle" });
  s.raw(`</g>`);
  return s;
}
