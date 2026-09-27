// 1. Объект — автомат-хваталка: Xiaohei джойстиком вытаскивает «склад» из кучи объектов.
import { Scene, INK, RED, BLUE, ORANGE } from "../lib.mjs";

export default function draw() {
  const s = new Scene(1);
  s.line(370, 818, 1110, 818, { strokeWidth: 2.6, roughness: 1.1 });

  // корпус
  s.rect(612, 112, 416, 70, { strokeWidth: 3.4 });
  for (const x of [668, 744, 820, 896, 972]) s.circle(x, 147, 16, { strokeWidth: 2.6 });
  s.rect(612, 182, 416, 380);
  s.rect(640, 198, 360, 342, { strokeWidth: 2.8 });
  s.line(662, 300, 706, 248, { strokeWidth: 2.4 });
  s.line(668, 332, 726, 262, { strokeWidth: 2.4 });
  s.line(652, 224, 988, 224, { strokeWidth: 2.6 });
  s.line(652, 234, 988, 234, { strokeWidth: 2.6 });
  s.rect(792, 214, 56, 26, { strokeWidth: 3 });
  s.line(820, 240, 820, 316, { strokeWidth: 2.8, roughness: 0.4 });
  s.rect(804, 314, 32, 20, { strokeWidth: 3 });

  // модель склада: широкая, низкая, пологая крыша, два рольставня
  s.poly([[748, 392], [820, 368], [892, 392]], { strokeWidth: 3 });
  s.rect(756, 392, 128, 60, { strokeWidth: 3 });
  for (const x0 of [770, 834]) {
    s.rect(x0, 414, 36, 38, { strokeWidth: 2.4 });
    for (const y of [423, 432, 441]) s.line(x0 + 2, y, x0 + 34, y, { strokeWidth: 1.8 });
  }
  // захват: лапы с шарнирами цепляют под свес крыши
  s.lines([[810, 334], [772, 352], [752, 384], [764, 400]], { strokeWidth: 3.4, roughness: 0.5 });
  s.lines([[830, 334], [868, 352], [888, 384], [876, 400]], { strokeWidth: 3.4, roughness: 0.5 });
  s.circle(772, 352, 9, { fill: INK, fillStyle: "solid", strokeWidth: 2 });
  s.circle(868, 352, 9, { fill: INK, fillStyle: "solid", strokeWidth: 2 });
  // поднят из кучи
  s.arrow([[820, 530], [822, 500], [820, 468]], { color: ORANGE, width: 3.4, head: 18 });

  // куча: диспетчерская вышка с самолётом, клиника
  s.rect(696, 446, 14, 94, { strokeWidth: 2.8 });
  s.poly([[688, 446], [718, 446], [730, 414], [676, 414]], { strokeWidth: 2.8 });
  s.line(680, 426, 726, 426, { strokeWidth: 1.8 });
  s.line(672, 412, 734, 412, { strokeWidth: 3 });
  s.line(703, 410, 703, 392, { strokeWidth: 2.4 });
  s.path("M722 528 C740 516 790 514 810 520 C818 524 814 532 804 534 L734 536 C724 536 718 532 722 528 Z", { strokeWidth: 2.6 });
  s.poly([[758, 526], [784, 526], [766, 548]], { strokeWidth: 2.4 });
  s.poly([[726, 526], [718, 502], [740, 522]], { strokeWidth: 2.4 });
  s.rect(876, 466, 100, 74, { strokeWidth: 2.8 });
  s.line(870, 466, 982, 466, { strokeWidth: 3 });
  s.poly([[918, 484], [934, 484], [934, 496], [946, 496], [946, 510], [934, 510], [934, 522], [918, 522], [918, 510], [906, 510], [906, 496], [918, 496]], { strokeWidth: 2.4 });

  // пульт
  s.poly([[612, 562], [1028, 562], [1046, 642], [594, 642]]);
  s.ellipse(682, 604, 46, 14, { strokeWidth: 2.6 });
  s.line(682, 602, 668, 552, { strokeWidth: 3.4, roughness: 0.3 });
  s.circle(666, 544, 26, { fill: INK, fillStyle: "solid", strokeWidth: 2.6 });
  s.rect(790, 578, 104, 48, { strokeWidth: 2.8 });
  s.rect(912, 578, 104, 48, { strokeWidth: 2.8 });
  s.text("демо", 842, 614, { size: 40, anchor: "middle" });
  s.text("свои", 964, 614, { size: 40, anchor: "middle" });
  // низ корпуса
  s.rect(612, 642, 416, 162);
  s.rect(672, 690, 22, 46, { strokeWidth: 2.4 });
  s.line(683, 698, 683, 728, { strokeWidth: 2 });
  s.rect(860, 684, 124, 80, { strokeWidth: 2.8 });
  s.line(860, 704, 984, 704, { strokeWidth: 2.2 });
  s.hatch([[862, 706], [982, 706], [982, 762], [862, 762]], { hachureGap: 10 });
  s.rect(628, 804, 40, 12, { strokeWidth: 2.4 });
  s.rect(972, 804, 40, 12, { strokeWidth: 2.4 });

  // ящик и Xiaohei на нём: рука на джойстике, взгляд на захвате
  s.rect(420, 734, 120, 82, { strokeWidth: 3 });
  s.line(424, 812, 536, 738, { strokeWidth: 2.4 });
  s.line(420, 762, 540, 762, { strokeWidth: 2 });
  s.xiaohei({
    cx: 482, cy: 626, w: 102, h: 132, look: [10, -6], eyeGap: 16,
    legs: [[[462, 688], [460, 712], [458, 733]], [[502, 688], [505, 712], [508, 733]]],
    arms: [[[528, 612], [584, 590], [636, 562], [656, 550]], [[436, 626], [420, 662], [424, 694]]],
  });

  // подписи
  s.text("склад", 1092, 330, { size: 68, color: RED, rotate: -3 });
  s.arrow([[1086, 346], [990, 370], [898, 392]], { color: RED, width: 3.2, head: 20 });
  s.text("аэропорт", 598, 498, { size: 50, color: BLUE, anchor: "end" });
  s.text("медучреждение", 1046, 512, { size: 50, color: BLUE });
  return s;
}
