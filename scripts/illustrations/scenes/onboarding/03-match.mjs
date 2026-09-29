// 3. Подбор — подобрать ключ: с доски ключей-роботов (каталог) Xiaohei взял тот, что открыл замок объекта.
import { Scene, INK, RED, BLUE, ORANGE, measure } from "../../lib.mjs";

export default function draw() {
  const s = new Scene(3);
  s.line(470, 790, 1240, 790, { strokeWidth: 2.6, roughness: 1.1 });

  // ключница = каталог; второй крючок пуст
  s.rect(150, 206, 390, 40, { strokeWidth: 3 });
  s.circle(168, 226, 8, { strokeWidth: 1.8 });
  s.circle(522, 226, 8, { strokeWidth: 1.8 });
  const bows = [
    (x, y) => { s.circle(x, y, 34, { strokeWidth: 2.4 }); s.circle(x, y, 10, { strokeWidth: 1.8 }); },
    null,
    (x, y) => s.poly([[x, y - 18], [x + 18, y + 14], [x - 18, y + 14]], { strokeWidth: 2.4 }),
    (x, y) => { s.rect(x - 16, y - 16, 32, 32, { strokeWidth: 2.4 }); s.line(x, y - 16, x, y - 26, { strokeWidth: 2 }); },
    (x, y) => { s.lines([[x - 14, y + 14], [x - 14, y - 6], [x + 10, y - 16]], { strokeWidth: 3 }); s.circle(x + 12, y - 16, 10, { strokeWidth: 2 }); s.line(x - 22, y + 16, x - 4, y + 16, { strokeWidth: 3 }); },
  ];
  bows.forEach((bow, i) => {
    const x = 196 + i * 74;
    s.curve([[x, 246], [x, 258], [x + 6, 262], [x + 8, 256]], { strokeWidth: 2.4, roughness: 0.3 });
    if (!bow) return;
    bow(x, 290);
    s.line(x, 308, x, 392, { strokeWidth: 2.6 });
    s.lines([[x, 364], [x + 10, 364], [x + 10, 372], [x, 372]], { strokeWidth: 2.2 });
    s.lines([[x, 380], [x + 8, 380], [x + 8, 390]], { strokeWidth: 2.2 });
  });
  s.text("каталог", 116, 476, { size: 54, color: BLUE });

  // навесной замок с объектом на корпусе; дужка справа выскочила
  s.arc(900, 222, 220, 150, Math.PI, Math.PI * 2, { strokeWidth: 3.4 });
  s.arc(900, 222, 160, 96, Math.PI, Math.PI * 2, { strokeWidth: 3.4 });
  s.line(790, 222, 790, 332);
  s.line(820, 222, 820, 332);
  s.line(1010, 222, 1010, 290);
  s.line(980, 222, 980, 290);
  s.line(978, 292, 1012, 292, { strokeWidth: 3 });
  for (const [x1, y1, x2, y2] of [[1030, 292, 1054, 280], [1028, 310, 1056, 312], [1020, 326, 1038, 344]]) s.line(x1, y1, x2, y2, { strokeWidth: 2.6 });
  s.rect(760, 332, 280, 258, { strokeWidth: 3.6 });
  s.hatch([[1010, 336], [1036, 336], [1036, 586], [1010, 586]], { hachureGap: 10 });
  s.poly([[846, 420], [900, 398], [954, 420]], { strokeWidth: 2.6 });
  s.rect(852, 420, 96, 54, { strokeWidth: 2.6 });
  s.rect(884, 442, 32, 32, { strokeWidth: 2.2 });
  s.circle(900, 530, 28, { fill: INK, fillStyle: "solid", strokeWidth: 2 });
  // подошедший ключ: стержень из скважины, головка — колёсный робот со второго крючка
  s.mask([[904, 536], [894, 526], [826, 612], [838, 620]]);
  s.line(904, 536, 838, 618, { strokeWidth: 3 });
  s.line(894, 526, 826, 610, { strokeWidth: 3 });
  s.rect(776, 606, 76, 42, { strokeWidth: 3, fill: "#fff", fillStyle: "solid" });
  s.circle(794, 654, 20, { strokeWidth: 2.6, fill: "#fff", fillStyle: "solid" });
  s.circle(834, 654, 20, { strokeWidth: 2.6, fill: "#fff", fillStyle: "solid" });
  s.line(814, 606, 814, 590, { strokeWidth: 2.4 });
  s.circle(814, 586, 9, { fill: INK, fillStyle: "solid", strokeWidth: 1.6 });
  s.arrow([[870, 668], [890, 636], [874, 602]], { color: ORANGE, width: 3.4, head: 16 });
  // от пустого крючка к замку
  s.arrow([[272, 306], [292, 420], [470, 520], [748, 588]], { color: ORANGE, width: 3.2, head: 20, o: { strokeLineDash: [14, 12] } });

  s.xiaohei({
    cx: 648, cy: 668, w: 100, h: 128, look: [12, -4], eyeGap: 15,
    legs: [[[628, 728], [626, 758], [624, 788]], [[668, 728], [671, 758], [674, 788]]],
    arms: [[[692, 640], [730, 622], [770, 618]], [[696, 676], [734, 660], [770, 638]]],
  });

  // бирка «почему этот» на ключе
  s.curve([[852, 626], [884, 650], [920, 664]], { strokeWidth: 2 });
  const tw = measure("почему этот", 44) + 60;
  s.raw(`<g transform="rotate(4 910 650)">`);
  s.mask([[910, 650], [910 + tw, 650], [910 + tw, 768], [910, 768]]);
  s.rect(910, 650, tw, 118, { strokeWidth: 3 });
  s.circle(928, 670, 12, { strokeWidth: 2.2 });
  s.text("почему этот", 940, 706, { size: 44 });
  s.curve([[940, 734], [970, 728], [1000, 736], [1030, 728], [1060, 734], [1090, 730]], { strokeWidth: 2.2, roughness: 0.8 });
  s.curve([[940, 754], [970, 750], [1000, 756], [1030, 750]], { strokeWidth: 2.2, roughness: 0.8 });
  s.raw(`</g>`);

  s.text("подходит", 1068, 286, { size: 66, color: RED, rotate: -4 });
  return s;
}
