// Карта расчёта для /methodology/tz: Xiaohei на дрезине везёт вагончик нормативов по станциям
// расчёта — от параметров объекта до NPV; у станции «парк» — петля имитации. Каждая станция —
// кликабельная область (hotspots): ссылка на свой раздел страницы.
import { Scene, INK, RED, BLUE, ORANGE, measure } from "../../lib.mjs";

const WHITE = { fill: "#fff", fillStyle: "solid" };
const X0 = 190, X1 = 1480;
/** Ось пути: чуть волнистая линия слева направо. */
const trackY = (x) => 400 + 20 * Math.sin(((x - X0) / (X1 - X0)) * 3 * Math.PI);
const slope = (x) => (trackY(x + 1) - trackY(x - 1)) / 2;

/**
 * Станции: подпись на табличке, раздел страницы (якорь и название — для подписи ссылки), x на
 * пути, верх таблички, цвет подписи. Таблички чередуются по высоте, чтобы не наезжать друг на друга.
 */
const STATIONS = [
  { label: "спрос", href: "#f-demand", title: "Режим работы и спрос", x: 560, top: 150, color: INK },
  { label: "парк", href: "#f-fleet", title: "Производительность и парк", x: 720, top: 232, color: INK },
  { label: "труд", href: "#f-labour", title: "Труд", x: 880, top: 150, color: INK },
  { label: "CAPEX", href: "#f-capex", title: "CAPEX", x: 1040, top: 232, color: INK },
  { label: "OPEX", href: "#f-opex", title: "OPEX", x: 1200, top: 150, color: INK },
  { label: "эффект · NPV", href: "#f-finance", title: "Эффект, окупаемость, ROI, NPV и TCO", x: 1392, top: 232, color: RED },
];

/** Рисунок строится с запасом сверху; пустая полоса срезается сдвигом на DY. */
const DY = 60;

export default function draw() {
  const s = new Scene(20, { w: 1600, h: 580 });
  const hotspots = [];
  const pad = (x, y, w, h, p = 14) => ({ x: x - p, y: y - p, w: w + 2 * p, h: h + 2 * p });

  // рельсы и шпалы
  for (const off of [-9, 9]) {
    const pts = [];
    for (let x = X0; x <= X1; x += 20) {
      const k = slope(x), n = Math.hypot(1, k);
      pts.push([x - (off * k) / n, trackY(x) + off / n]);
    }
    s.curve(pts, { strokeWidth: 3, roughness: 0.5 });
  }
  for (let x = X0 + 8; x < X1; x += 26) {
    const k = slope(x), n = Math.hypot(1, k);
    const [nx, ny] = [-k / n, 1 / n];
    s.line(x - nx * 17, trackY(x) - ny * 17, x + nx * 17, trackY(x) + ny * 17, { strokeWidth: 2.2, roughness: 0.4 });
  }
  // упор в конце пути
  s.rect(X1 + 6, trackY(X1) - 34, 18, 44, { strokeWidth: 3, fill: "#fff", fillStyle: "solid" });
  s.line(X1 + 6, trackY(X1) - 34, X1 + 24, trackY(X1) + 10, { strokeWidth: 2.2 });

  // старт: объект и его параметры
  s.poly([[52, 330], [112, 296], [172, 330]], { strokeWidth: 3 });
  s.rect(60, 330, 104, 70, { strokeWidth: 3 });
  s.rect(92, 354, 40, 46, { strokeWidth: 2.4 });
  for (const y of [364, 374, 384, 394]) s.line(94, y, 130, y, { strokeWidth: 1.6 });
  s.line(40, trackY(X0) + 12, 190, trackY(X0) + 12, { strokeWidth: 2.4, roughness: 1 });
  s.text("параметры", 112, 462, { size: 42, anchor: "middle" });
  s.text("объекта", 112, 504, { size: 42, anchor: "middle" });
  hotspots.push({ id: "params", href: "#processes", label: "Процессы и спрос: из каких параметров объекта всё считается", x: 12, y: 284, w: 186, h: 236 });

  // станции: платформа у пути, столб, табличка
  for (const st of STATIONS) {
    const y = trackY(st.x);
    const tw = measure(st.label, 50);
    const bw = tw + 44, bh = 66, bx = st.x - bw / 2;
    s.rect(st.x - 38, y - 30, 76, 14, { strokeWidth: 2.6, ...WHITE });
    s.line(st.x, y - 30, st.x, st.top + bh, { strokeWidth: 3 });
    s.rect(bx, st.top, bw, bh, { strokeWidth: 3, ...WHITE });
    s.text(st.label, st.x, st.top + 47, { size: 50, anchor: "middle", color: st.color });
    hotspots.push({ id: st.href.slice(1), href: st.href, label: `Формулы: ${st.title}`, ...pad(bx, st.top, bw, bh, 6) });
  }

  // петля имитации под станцией «парк»: пробный круг, по которому едет робот
  const park = STATIONS[1];
  s.line(park.x, trackY(park.x) + 18, park.x + 8, 500, { stroke: ORANGE, strokeWidth: 3, strokeLineDash: [10, 9], roughness: 0.4 });
  s.ellipse(760, 548, 270, 92, { stroke: ORANGE, strokeWidth: 3.4, strokeLineDash: [16, 11], roughness: 0.6 });
  s.rect(812, 566, 40, 24, { strokeWidth: 2.6, ...WHITE });
  s.circle(820, 594, 12, { strokeWidth: 2.2, ...WHITE });
  s.circle(844, 594, 12, { strokeWidth: 2.2, ...WHITE });
  s.circle(832, 578, 7, { fill: INK, fillStyle: "solid", strokeWidth: 1.4 });
  s.text("имитация", 912, 566, { size: 48, color: BLUE });
  hotspots.push({ id: "simulation", href: "#simulation", label: "Имитация: проверка рассчитанного парка", ...pad(620, 490, 520, 120, 6) });

  // вагончик нормативов и дрезина с Xiaohei
  const wx = 242, wy = trackY(wx + 56);
  s.rect(wx, wy - 76, 112, 52, { strokeWidth: 3, ...WHITE });
  for (const [dx, gs] of [[26, 22], [56, 30], [88, 18]]) {
    const gx = wx + dx;
    s.path(`M${gx - gs / 2} ${wy - 76} L${gx - gs / 3} ${wy - 76 - gs} L${gx + gs / 3} ${wy - 76 - gs} L${gx + gs / 2} ${wy - 76} Z`, { strokeWidth: 2.4, fill: "#fff", fillStyle: "solid" });
    s.circle(gx, wy - 80 - gs, 10, { strokeWidth: 2 });
  }
  s.circle(wx + 26, wy - 16, 26, { strokeWidth: 2.6, ...WHITE });
  s.circle(wx + 86, wy - 16, 26, { strokeWidth: 2.6, ...WHITE });
  const nt = s.text("нормативы", wx + 56, wy - 132, { size: 44, color: BLUE, anchor: "middle" });
  hotspots.push({ id: "norms", href: "#norms", label: "Нормативы и допущения", x: nt.x0 - 6, y: wy - 176, w: nt.w + 12, h: 176 });
  s.line(wx + 112, wy - 36, wx + 132, wy - 36, { strokeWidth: 3 });

  const hx = wx + 132, hy = trackY(hx + 56);
  s.rect(hx, hy - 44, 112, 16, { strokeWidth: 3, ...WHITE });
  s.circle(hx + 22, hy - 18, 28, { strokeWidth: 2.6, ...WHITE });
  s.circle(hx + 90, hy - 18, 28, { strokeWidth: 2.6, ...WHITE });
  s.line(hx + 82, hy - 44, hx + 82, hy - 100, { strokeWidth: 3.4 });
  s.line(hx + 44, hy - 116, hx + 118, hy - 88, { strokeWidth: 4, roughness: 0.3 });
  s.circle(hx + 82, hy - 102, 9, { fill: INK, fillStyle: "solid", strokeWidth: 1.6 });
  s.xiaohei({
    cx: hx + 30, cy: hy - 92, w: 58, h: 76, look: [8, -4], eyeGap: 10, eyeY: -0.22,
    legs: [[[hx + 20, hy - 56], [hx + 19, hy - 50], [hx + 18, hy - 45]], [[hx + 40, hy - 56], [hx + 41, hy - 50], [hx + 42, hy - 45]]],
    arms: [[[hx + 54, hy - 104], [hx + 50, hy - 112], [hx + 46, hy - 116]], [[hx + 56, hy - 88], [hx + 72, hy - 108], [hx + 48, hy - 116]]],
  });
  s.arrow([[hx + 124, hy - 66], [hx + 146, trackY(hx + 146) - 68], [hx + 166, trackY(hx + 166) - 68]], { color: ORANGE, width: 3.4, head: 14 });

  s.parts = [`<g transform="translate(0 ${-DY})">`, ...s.parts, "</g>"];
  s.hotspots = hotspots.map((h) => ({ ...h, x: Math.round(h.x), y: Math.round(h.y - DY), w: Math.round(h.w), h: Math.round(h.h) }));
  return s;
}
