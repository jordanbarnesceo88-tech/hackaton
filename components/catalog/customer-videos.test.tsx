import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SHEET_VIDEOS } from "@/lib/data/customer-videos";
import Home from "@/app/page";
import { CustomerVideos } from "./customer-videos";

vi.mock("@/components/landing/cleaning-robot-3d", () => ({ CleaningRobot3D: () => createElement("div", { "data-first-screen-canvas": true }) }));
vi.mock("@/components/onboarding/onboarding-tour", () => ({ OnboardingTour: () => createElement("button", null, "Экскурсия") }));

describe("linked videos in the incumbent catalog and home", () => {
  it("renders the school customer interview with issuer and verification basis separately on the exact CC1 card", () => {
    const html = renderToStaticMarkup(createElement(CustomerVideos, { productSlug: "pudu-cc1" }));
    for (const text of ["Интервью с заказчиком", "SPI robotics", "Иван Мальцев", "Wunderpark", "по описанию", "Видео целиком не просмотрено", "03.07.2025", "20.10.2026", "CC1", "Проспект"]) expect(html).toContain(text);
    expect(html).toContain('href="https://rutube.ru/video/e9d23b3512cbdbad16363a493cb88841/"');
    expect(html).not.toContain("Pudu News-Delivery");
    expect(html).not.toContain("VIGGO SC80 PRO");
    expect(html).not.toMatch(/<(iframe|video|img)\b|rel="preload"|autoplay/i);
  });

  it("keeps all 65 source links available in a closed disclosure, including unbound families and the claimed Mark 2 review", () => {
    const html = renderToStaticMarkup(createElement(CustomerVideos));
    expect(html).toContain("Все 65 видеоматериалов из таблицы");
    expect(html).not.toMatch(/<details[^>]*\sopen[\s=>]/);
    for (const video of SHEET_VIDEOS) expect(html).toContain(`href="${video.url}"`);
    for (const id of ["777001:5", "777004:13", "777004:33"]) {
      const article = html.split(`data-video-id="${id}"`)[1]!.split("</article>")[0]!;
      expect(article).toContain("Без привязки к модели каталога"); expect(article).not.toContain('href="/catalog/');
    }
    expect(html).toContain("Отзыв — по названию автора"); expect(html).toContain("не содержат видео");
  });

  it("gives watch links descriptive accessible names and discloses new tabs without loading media", () => {
    const html = renderToStaticMarkup(createElement(CustomerVideos));
    expect(html).toContain("aria-label=\"Смотреть «SPI robotics:");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Источник и границы проверки");
    expect(html).not.toMatch(/<(iframe|video|img)\b|rel="preload"|autoplay/i);
  });

  it("renders nothing for a catalog model without an exact binding", () => {
    expect(renderToStaticMarkup(createElement(CustomerVideos, { productSlug: "waybot-klinbotiks-600" }))).toBe("");
    expect(renderToStaticMarkup(createElement(CustomerVideos, { productSlug: "unknown" }))).toBe("");
  });

  it("places the home video section after the original first screen and keeps the whole page free to grow", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html.indexOf('id="customer-videos"')).toBeGreaterThan(html.indexOf("</footer>"));
    expect(html.indexOf("</footer>")).toBeGreaterThan(html.indexOf("data-first-screen-canvas"));
    expect(html).not.toContain("xl:h-[calc(100dvh-60px)]");
    expect(html).toContain("xl:min-h-[calc(100dvh-60px)]");
    expect(html).toContain("Отзывы заказчиков и видео внедрений");
  });
});
