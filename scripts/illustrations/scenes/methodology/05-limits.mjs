// Ограничения: Xiaohei светит фонариком. В луче — то, что модель считает полностью (склад,
// паллеты); на краю луча — аэропорт и медучреждение (прототип); за лучом — то, чего модель не знает.
import { Scene, RED, BLUE } from "../../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };

export default function draw() {
  const s = new Scene(25);
  s.line(120, 700, 520, 700, { strokeWidth: 2.6, roughness: 1.1 });

  // темнота за пределами луча
  const dark = [[1370, 150], [1540, 150], [1540, 820], [1370, 820], [1390, 700], [1360, 560], [1392, 420], [1362, 290]];
  s.hatch(dark, { hachureGap: 9, hachureAngle: -48, fillWeight: 1.6 });
  for (const [x, y] of [[1452, 330], [1440, 640]]) {
    s.maskEllipse(x, y - 30, 90, 110);
    s.text("?", x, y, { size: 96, anchor: "middle" });
  }
  s.maskEllipse(1455, 486, 200, 70);
  s.text("вне модели", 1455, 500, { size: 44, anchor: "middle" });

  // луч
  s.line(496, 468, 1370, 190, { strokeWidth: 2.4, roughness: 1 });
  s.line(496, 548, 1370, 810, { strokeWidth: 2.4, roughness: 1 });
  for (const [x1, y1, x2, y2] of [[560, 486, 640, 470], [560, 530, 640, 546]]) s.line(x1, y1, x2, y2, { strokeWidth: 1.8 });

  // в свету: склад, паллета, робот
  s.poly([[690, 470], [770, 440], [850, 470]], { strokeWidth: 3 });
  s.rect(700, 470, 140, 90, { strokeWidth: 3, ...WHITE });
  s.rect(748, 500, 44, 60, { strokeWidth: 2.4 });
  for (const y of [512, 524, 536, 548]) s.line(750, y, 790, y, { strokeWidth: 1.6 });
  s.rect(880, 526, 70, 34, { strokeWidth: 2.6, ...WHITE });
  s.circle(893, 564, 14, { strokeWidth: 2.2, ...WHITE });
  s.circle(937, 564, 14, { strokeWidth: 2.2, ...WHITE });
  s.rect(890, 506, 50, 20, { strokeWidth: 2.2, ...WHITE });
  s.text("считается полностью", 640, 300, { size: 52, color: RED, anchor: "middle", rotate: -3 });
  s.arrow([[700, 322], [742, 370], [764, 428]], { color: RED, width: 3, head: 16 });

  // на краю луча — прототип: аэропорт наверху, медучреждение внизу
  s.rect(1160, 300, 22, 110, { strokeWidth: 2.6 });
  s.poly([[1146, 300], [1196, 300], [1206, 268], [1136, 268]], { strokeWidth: 2.6, ...WHITE });
  s.line(1171, 268, 1171, 246, { strokeWidth: 2.2 });
  s.hatch([[1136, 246], [1210, 246], [1210, 290], [1136, 290]], { hachureGap: 10, hachureAngle: -48 });
  s.rect(1150, 610, 130, 90, { strokeWidth: 2.6, ...WHITE });
  s.poly([[1204, 628], [1226, 628], [1226, 646], [1244, 646], [1244, 668], [1226, 668], [1226, 686], [1204, 686], [1204, 668], [1186, 668], [1186, 646], [1204, 646]], { strokeWidth: 2.2 });
  s.hatch([[1230, 700], [1282, 700], [1282, 740], [1230, 740]], { hachureGap: 10, hachureAngle: -48 });
  s.text("прототип", 1215, 490, { size: 50, color: BLUE, anchor: "middle" });

  // Xiaohei с фонариком
  s.rect(300, 482, 150, 52, { strokeWidth: 3.2, ...WHITE });
  s.poly([[450, 474], [496, 452], [496, 564], [450, 542]], { strokeWidth: 3.2, ...WHITE });
  s.line(330, 482, 330, 534, { strokeWidth: 2 });
  s.xiaohei({
    cx: 250, cy: 596, w: 100, h: 128, look: [14, -6], eyeGap: 15,
    legs: [[[230, 656], [228, 680], [226, 698]], [[270, 656], [273, 680], [276, 698]]],
    arms: [[[294, 566], [310, 540], [318, 520]], [[296, 606], [340, 560], [372, 534]]],
  });
  return s;
}
