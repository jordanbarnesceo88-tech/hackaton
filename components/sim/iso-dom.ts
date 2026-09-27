import { botMarkup, botTitle, routeMarkup, type IsoFrame } from "./iso-scene";

/**
 * Покадровое обновление изометрической схемы на экране. Статичная часть (пол, стеллажи, стены)
 * собирается один раз; здесь по кадру двигаются роботы, меняются их пути, занятость точек и
 * часы — точечно, без перерисовки сцены, как в «живом слое» прототипа (render-agents).
 *
 * Узлы роботов и путей переиспользуются: перестановка разметки на каждом кадре сбрасывала бы
 * анимацию бегущего пунктира и заставляла браузер разбирать сотни элементов 60 раз в секунду.
 */
export type IsoDom = {
  bots: SVGGElement;
  routes: SVGGElement;
  clock: SVGTextElement | null;
  caption: SVGTextElement | null;
  pads: Map<string, SVGElement>;
  botNodes: SVGGElement[];
  routeNodes: Map<number, SVGPolylineElement>;
};

/** Узлы схемы, которые меняются по кадрам. null — разметка ещё не вставлена. */
export function bindIsoDom(svg: SVGSVGElement): IsoDom | null {
  const bots = svg.querySelector<SVGGElement>("g.iso-bots");
  const routes = svg.querySelector<SVGGElement>("g.iso-routes");
  if (!bots || !routes) return null;
  const pads = new Map<string, SVGElement>();
  svg.querySelectorAll<SVGElement>(".iso-pad[data-point]").forEach((el) => pads.set(el.dataset.point ?? "", el));
  return {
    bots,
    routes,
    clock: svg.querySelector<SVGTextElement>("text.iso-hud-clock"),
    caption: svg.querySelector<SVGTextElement>("text.iso-hud-caption"),
    pads,
    botNodes: [],
    routeNodes: new Map(),
  };
}

/** Кадр на экран. null — прогона ещё нет: пустой склад. */
export function applyIsoFrame(dom: IsoDom, frame: IsoFrame | null): void {
  const bots = frame?.bots ?? [];
  if (dom.botNodes.length !== bots.length) {
    dom.bots.innerHTML = bots.map(botMarkup).join("");
    dom.botNodes = Array.from(dom.bots.children) as SVGGElement[];
  } else {
    bots.forEach((b, i) => {
      const node = dom.botNodes[i]!;
      node.setAttribute("transform", `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`);
      if (node.getAttribute("data-glyph") !== b.glyph) {
        node.setAttribute("data-glyph", b.glyph);
        const title = node.querySelector("title");
        if (title) title.textContent = botTitle(b);
      }
    });
  }

  const seen = new Set<number>();
  for (const r of frame?.routes ?? []) {
    seen.add(r.id);
    let node = dom.routeNodes.get(r.id);
    if (!node) {
      dom.routes.insertAdjacentHTML("beforeend", routeMarkup(r));
      node = dom.routes.lastElementChild as SVGPolylineElement;
      dom.routeNodes.set(r.id, node);
    } else {
      node.setAttribute("points", r.points);
      node.setAttribute("data-kind", r.kind);
    }
    node.style.display = "";
  }
  for (const [id, node] of dom.routeNodes) if (!seen.has(id)) node.style.display = "none";

  const busy = new Set(frame?.busy ?? []);
  for (const [id, el] of dom.pads) el.setAttribute("data-busy", busy.has(id) ? "1" : "0");

  if (dom.clock) dom.clock.textContent = frame?.clock ?? "";
  if (dom.caption) dom.caption.textContent = frame?.caption ?? "";
}
