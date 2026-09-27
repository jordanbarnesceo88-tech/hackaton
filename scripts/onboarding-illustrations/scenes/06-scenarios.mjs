// 6. Сценарии — три дороги из одной точки; Xiaohei смотрит на все три разом в тройную подзорную трубу.
import { Scene, RED, BLUE, ORANGE } from "../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };
const DASH = { stroke: ORANGE, strokeWidth: 4, roughness: 0.6, strokeLineDash: [18, 12] };

export default function draw() {
  const s = new Scene(6);
  s.raw(`<g transform="translate(0 -36)">`);
  // покупка: сначала крутой подъём, потом долгий пологий спуск
  s.curve([[600, 742], [690, 610], [760, 430], [820, 392], [900, 420], [1060, 488], [1200, 520], [1320, 530]], { strokeWidth: 2.8 });
  s.hatch([[640, 700], [700, 590], [750, 460], [790, 410], [790, 742]], { hachureGap: 12, hachureAngle: 50 });
  s.curve([[470, 744], [620, 690], [700, 560], [770, 410], [822, 374], [906, 402], [1064, 470], [1200, 502], [1316, 510]], DASH);
  // услуга: ровная, со шлагбаумами оплаты
  s.curve([[470, 752], [700, 700], [1000, 672], [1316, 662]], DASH);
  for (const x of [800, 980, 1160]) {
    const y = 700 - (x - 700) * 0.1;
    s.line(x, y + 8, x, y - 46, { strokeWidth: 3 });
    s.line(x - 4, y - 42, x + 44, y - 50, { strokeWidth: 3 });
    s.line(x + 14, y - 44, x + 16, y - 50, { strokeWidth: 2 });
    s.line(x + 30, y - 47, x + 32, y - 53, { strokeWidth: 2 });
  }
  // как есть: ровная, по ней идут всё те же люди
  s.curve([[470, 760], [800, 792], [1100, 800], [1316, 806]], DASH);
  for (const x of [820, 1000, 1180]) {
    const y = 770 + (x - 800) * 0.03;
    s.circle(x, y - 46, 16, { strokeWidth: 2.4 });
    s.line(x, y - 38, x, y - 12, { strokeWidth: 2.4 });
    s.line(x, y - 12, x - 8, y + 4, { strokeWidth: 2.4 });
    s.line(x, y - 12, x + 8, y + 4, { strokeWidth: 2.4 });
    s.line(x, y - 30, x + 10, y - 20, { strokeWidth: 2.4 });
  }

  // Xiaohei на камне с тройной подзорной трубой: по трубе на дорогу
  s.poly([[270, 820], [300, 760], [420, 752], [462, 820]], { strokeWidth: 3, ...WHITE });
  s.xiaohei({
    cx: 352, cy: 684, w: 100, h: 128, look: [14, -4], eyeGap: 14,
    legs: [[[334, 744], [332, 750], [330, 758]], [[372, 744], [374, 750], [376, 756]]],
    arms: [[[396, 660], [430, 646], [452, 640]], [[394, 700], [430, 690], [456, 676]]],
  });
  const eye = [398, 656];
  for (const deg of [-24, 0, 22]) {
    const a = (deg * Math.PI) / 180;
    const ex = eye[0] + 150 * Math.cos(a), ey = eye[1] + 150 * Math.sin(a);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const w0 = 8, w1 = 12;
    s.poly([
      [eye[0] + nx * w0, eye[1] + ny * w0], [ex + nx * w1, ey + ny * w1],
      [ex - nx * w1, ey - ny * w1], [eye[0] - nx * w0, eye[1] - ny * w0],
    ], { strokeWidth: 2.8, ...WHITE });
    const mx = eye[0] + 70 * Math.cos(a), my = eye[1] + 70 * Math.sin(a);
    s.line(mx + nx * 11, my + ny * 11, mx - nx * 11, my - ny * 11, { strokeWidth: 2.2 });
    s.line(ex + nx * 15, ey + ny * 15, ex - nx * 15, ey - ny * 15, { strokeWidth: 3.2 });
  }

  s.text("покупка", 1336, 526, { size: 48 });
  s.text("услуга", 1336, 676, { size: 48 });
  s.text("как есть", 1336, 822, { size: 48 });
  s.text("дорого вначале", 700, 390, { size: 44, color: BLUE, anchor: "end", rotate: -3 });
  s.text("каждый месяц", 1000, 590, { size: 44, color: BLUE, anchor: "middle" });
  s.text("все три разом", 110, 520, { size: 62, color: RED, rotate: -4 });
  s.raw(`</g>`);
  return s;
}
