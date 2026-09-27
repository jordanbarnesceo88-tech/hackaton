// 5. Экономика — арифмометр: Xiaohei крутит ручку допущения, машина печатает чек с CAPEX, OPEX, окупаемостью и NPV.
import { Scene, INK, RED, BLUE, ORANGE, measure } from "../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };

export default function draw() {
  const s = new Scene(5);
  s.line(300, 792, 1180, 792, { strokeWidth: 2.6, roughness: 1.1 });

  // чек из верхней щели, сверху — рваный край
  const rows = [["CAPEX", INK], ["OPEX", INK], ["окупаемость", INK], ["NPV", RED]];
  const tw = Math.max(...rows.map(([t]) => measure(t, 46))) + 64;
  const x0 = 780 - tw / 2, x1 = 780 + tw / 2;
  const top = [];
  for (let i = 0; i <= 12; i++) top.push([x0 + 12 + ((tw + 4) * i) / 12, 126 + (i % 2 ? -14 : 0) + i * 0.6]);
  s.poly([[x0 + 6, 486], [x0 - 2, 320], ...top, [x1 + 4, 320], [x1 - 6, 486]], { strokeWidth: 3, ...WHITE });
  rows.forEach(([t, c], i) => s.text(t, x0 + 30, 200 + i * 62, { size: 46, color: c }));
  s.line(x0 + 28, 396, x0 + 128, 394, { stroke: RED, strokeWidth: 3 });
  s.line(x0 + 30, 406, x0 + 124, 405, { stroke: RED, strokeWidth: 3 });
  s.curve([[x0 + 30, 446], [x0 + 80, 442], [x0 + 130, 448], [x0 + 180, 444]], { strokeWidth: 2, roughness: 0.8 });

  // машина
  s.poly([[560, 560], [1000, 560], [966, 480], [594, 480]], { strokeWidth: 3.4, ...WHITE });
  s.line(x0 + 4, 484, x1 - 4, 484, { strokeWidth: 5, roughness: 0.3 });
  s.rect(540, 560, 480, 232, { strokeWidth: 3.4, ...WHITE });
  s.hatch([[988, 564], [1016, 564], [1016, 788], [988, 788]], { hachureGap: 10 });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s.rect(844 + c * 42, 620 + r * 40, 30, 28, { strokeWidth: 2.2 });
  s.line(580, 750, 970, 750, { strokeWidth: 2.2 });
  s.circle(780, 770, 14, { strokeWidth: 2 });
  for (const [cx, a] of [[636, -0.9], [756, 0.6]]) {
    s.circle(cx, 666, 64, { strokeWidth: 3, ...WHITE });
    s.line(cx, 666, cx + 24 * Math.sin(a), 666 - 24 * Math.cos(a), { strokeWidth: 3.4, roughness: 0.2 });
    for (let k = -3; k <= 3; k++) {
      const t = (k * Math.PI) / 7;
      s.line(cx + 38 * Math.sin(t), 666 - 38 * Math.cos(t), cx + 46 * Math.sin(t), 666 - 46 * Math.cos(t), { strokeWidth: 1.8, roughness: 0.2 });
    }
  }
  s.text("допущения", 590, 606, { size: 44, color: BLUE });

  // Xiaohei обеими руками крутит левую ручку
  s.xiaohei({
    cx: 470, cy: 676, w: 102, h: 132, look: [12, -6], eyeGap: 16,
    legs: [[[450, 738], [446, 764], [442, 790]], [[490, 738], [494, 764], [498, 790]]],
    arms: [[[514, 646], [560, 636], [602, 648]], [[518, 690], [566, 690], [606, 680]]],
  });
  s.arrow([[590, 716], [636, 732], [682, 716]], { color: ORANGE, width: 3.4, head: 16 });
  return s;
}
