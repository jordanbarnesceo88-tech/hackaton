// Имитация: песочные часы пикового окна. Задания (паллеты) сыплются вниз через горлышко, где
// работают роботы — это и есть парк; если горлышко не успевает, над ним растёт очередь.
import { Scene, RED, BLUE } from "../../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };
/** Полуширина колбы на высоте y: верхняя сужается к горлышку, нижняя расширяется. */
function halfWidth(y) {
  if (y <= 450) {
    const t = (y - 150) / 300;
    return 170 - 140 * Math.pow(Math.max(0, t), 1.6);
  }
  const t = (y - 490) / 300;
  return 30 + 140 * (1 - Math.pow(Math.max(0, 1 - t), 1.6));
}

export default function draw() {
  const s = new Scene(23);
  const cx = 780;
  s.line(420, 830, 1500, 830, { strokeWidth: 2.6, roughness: 1.1 });

  // рама
  s.rect(560, 112, 440, 30, { strokeWidth: 3.2, ...WHITE });
  s.rect(560, 800, 440, 30, { strokeWidth: 3.2, ...WHITE });
  for (const x of [584, 976]) {
    s.line(x - 5, 142, x - 5, 800, { strokeWidth: 2.6 });
    s.line(x + 5, 142, x + 5, 800, { strokeWidth: 2.6 });
  }
  // колбы
  for (const sign of [-1, 1]) {
    const top = [], bot = [];
    for (let y = 142; y <= 450; y += 22) top.push([cx + sign * halfWidth(y), y]);
    top.push([cx + sign * 30, 450]);
    for (let y = 490; y <= 800; y += 22) bot.push([cx + sign * halfWidth(y), y]);
    bot.push([cx + sign * halfWidth(800), 800]);
    s.curve(top, { strokeWidth: 3, roughness: 0.5 });
    s.curve(bot, { strokeWidth: 3, roughness: 0.5 });
    s.line(cx + sign * 30, 450, cx + sign * 30, 490, { strokeWidth: 3 });
  }
  s.line(640, 190, 660, 330, { strokeWidth: 2.2 });

  // задания в верхней колбе
  const pal = (x, y, w = 24, h = 16) => s.rect(x - w / 2, y - h / 2, w, h, { strokeWidth: 2, ...WHITE });
  for (let y = 250; y <= 420; y += 22) {
    const hw = halfWidth(y) - 18;
    for (let x = cx - hw + 12; x <= cx + hw - 12; x += 30) pal(x, y);
  }
  // очередь у горлышка
  for (const [x, y] of [[768, 440], [794, 438], [781, 424]]) pal(x, y, 22, 14);
  // робот в горлышке везёт паллету вниз
  s.rect(764, 464, 32, 18, { strokeWidth: 2.4, ...WHITE });
  s.circle(772, 485, 8, { strokeWidth: 1.8, ...WHITE });
  s.circle(788, 485, 8, { strokeWidth: 1.8, ...WHITE });
  pal(780, 456, 24, 12);
  // второй робот уже внизу, под ним — сложенные паллеты
  s.rect(770, 560, 34, 20, { strokeWidth: 2.4, ...WHITE });
  s.circle(779, 584, 9, { strokeWidth: 1.8, ...WHITE });
  s.circle(795, 584, 9, { strokeWidth: 1.8, ...WHITE });
  for (let row = 0; row < 3; row++) {
    const y = 784 - row * 18;
    const n = 6 - row;
    for (let i = 0; i < n; i++) pal(cx - ((n - 1) * 30) / 2 + i * 30, y);
  }

  // Xiaohei с секундомером
  s.circle(1236, 470, 96, { strokeWidth: 3.2, ...WHITE });
  s.rect(1226, 408, 20, 16, { strokeWidth: 2.6, ...WHITE });
  s.line(1236, 470, 1258, 440, { strokeWidth: 3.2, roughness: 0.2 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    s.line(1236 + 38 * Math.cos(a), 470 + 38 * Math.sin(a), 1236 + 44 * Math.cos(a), 470 + 44 * Math.sin(a), { strokeWidth: 1.8, roughness: 0.2 });
  }
  s.xiaohei({
    cx: 1150, cy: 740, w: 100, h: 128, look: [-12, -6], eyeGap: 15,
    legs: [[[1130, 800], [1129, 815], [1128, 828]], [[1170, 800], [1172, 815], [1174, 828]]],
    arms: [[[1190, 712], [1210, 610], [1224, 520]], [[1104, 744], [1082, 768], [1084, 790]]],
  });

  s.text("очередь", 560, 444, { size: 56, color: RED, anchor: "end" });
  s.arrow([[568, 432], [660, 426], [748, 434]], { color: RED, width: 3, head: 16 });
  s.text("парк", 880, 486, { size: 50, color: BLUE });
  s.arrow([[872, 474], [840, 472], [808, 472]], { color: BLUE, width: 2.8, head: 14 });
  s.text("пик 120 мин", 1300, 400, { size: 50, color: BLUE });
  return s;
}
