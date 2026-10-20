import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { videosForProducts } from "@/lib/data/customer-videos";
import Home from "@/app/page";
import { CustomerVideos } from "./customer-videos";

vi.mock("@/components/landing/cleaning-robot-3d", () => ({ CleaningRobot3D: () => createElement("div", { "data-first-screen-canvas": true }) }));
vi.mock("@/components/onboarding/onboarding-tour", () => ({ OnboardingTour: () => createElement("button", null, "Экскурсия") }));

describe("videos matched to catalog models", () => {
  it("shows the exact CC1 videos without internal research links or review metadata", () => {
    const html = renderToStaticMarkup(createElement(CustomerVideos, { productSlug: "pudu-cc1" }));
    for (const text of ["Интервью с заказчиком", "SPI robotics", "Wunderpark", "CC1", "Кемерово"]) expect(html).toContain(text);
    for (const text of ["Источник и границы", "Исходная таблица", "docs.google.com", "rutube.ru/api", "по описанию", "Видео целиком не просмотрено", "проверено", "Классификация автора"]) expect(html).not.toContain(text);
    expect(html).toContain('href="https://rutube.ru/video/e9d23b3512cbdbad16363a493cb88841/"');
    expect(html).not.toContain("Pudu News-Delivery");
    expect(html).not.toContain("VIGGO SC80 PRO");
    expect(html).not.toMatch(/<(iframe|video|img)\b|rel="preload"|autoplay/i);
  });

  it("deduplicates videos for a mixed fleet and links each video to its exact catalog models", () => {
    const productSlugs = ["dikom-dmr-600", "dikom-dmr-300-carrier-b", "dikom-dmr-600"];
    const html = renderToStaticMarkup(createElement(CustomerVideos, { productSlugs, id: "mixed-videos" }));
    expect(html).toContain('id="mixed-videos"');
    expect(html).toContain('aria-labelledby="mixed-videos-title"');
    expect(html).toContain('href="/catalog/dikom-dmr-600#customer-videos"');
    expect(html).toContain('href="/catalog/dikom-dmr-300-carrier-b#customer-videos"');
    expect(html).not.toContain('href="/catalog/dikom-dmr-carrier-p#customer-videos"');
    for (const video of videosForProducts(productSlugs)) expect(html.split(`data-video-id="${video.id}"`)).toHaveLength(2);
    expect(html).not.toContain("Wunderpark");
  });

  it("gives watch links descriptive accessible names and discloses new tabs without loading media", () => {
    const html = renderToStaticMarkup(createElement(CustomerVideos, { productSlug: "pudu-cc1" }));
    expect(html).toContain("aria-label=\"Смотреть «SPI robotics:");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toMatch(/<(iframe|video|img)\b|rel="preload"|autoplay/i);
  });

  it("renders nothing for a catalog model without an exact binding", () => {
    expect(renderToStaticMarkup(createElement(CustomerVideos, { productSlug: "waybot-klinbotiks-600" }))).toBe("");
    expect(renderToStaticMarkup(createElement(CustomerVideos, { productSlug: "unknown" }))).toBe("");
    expect(renderToStaticMarkup(createElement(CustomerVideos))).toBe("");
    expect(renderToStaticMarkup(createElement(CustomerVideos, { productSlugs: [] }))).toBe("");
  });

  it("keeps videos off the homepage while preserving the first screen", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).not.toContain('id="customer-videos"');
    expect(html.indexOf("</footer>")).toBeGreaterThan(html.indexOf("data-first-screen-canvas"));
    expect(html).not.toContain("xl:h-[calc(100dvh-60px)]");
    expect(html).toContain("xl:min-h-[calc(100dvh-60px)]");
    expect(html).not.toContain("Отзывы заказчиков и видео внедрений");
  });
});
