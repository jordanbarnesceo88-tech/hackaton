import { describe, expect, it } from "vitest";
import { CATALOG } from "./organizer/catalog";
import { VENDOR_CLEANING_PRODUCTS } from "./vendor-cleaning";
import source from "./customer-videos.source.json";
import bindings from "./customer-videos.bindings.json";
import verification from "./customer-videos.verification.json";
import review from "./customer-videos.review.json";
import { CATALOG_VIDEOS, CUSTOMER_VIDEO_AUDIT, SCHOOL_CC1_REVIEW, SHEET_VIDEOS, videosForProduct } from "./customer-videos";

describe("spreadsheet video provenance and exact model bindings", () => {
  it("accounts for every source row and URL exactly once, including six explicit no-link entries", () => {
    expect(CUSTOMER_VIDEO_AUDIT).toMatchObject({ sourceRecords: 71, sourceLinks: 65, duplicateLinks: 0, missingLinks: 6,
      availableMetadata: 65, unavailableMetadata: 0, exactModelLinks: 31, unboundLinks: 34, descriptionsPresent: 55 });
    const ids = [...bindings.exact, ...bindings.omitted].map(r => r.sourceId);
    expect(new Set(ids).size).toBe(71);
    expect(ids.sort()).toEqual(source.records.map(r => `${r.sheetId}:${r.row}`).sort());
    expect(SHEET_VIDEOS.map(v => v.url)).toEqual(source.records.filter(r => r.url).map(r => r.url));
    expect(new Set(review.records.map(r => r.sourceId)).size).toBe(65);
    for (const row of bindings.omitted) expect(row.reason.trim().length).toBeGreaterThan(20);
  });

  it("preserves observed titles, channels, dates and row-level provenance without treating metadata as playback or a field measurement", () => {
    for (const video of SHEET_VIDEOS) {
      const observed = verification.records.find(r => r.url === video.url)!;
      expect(video.title).toBe(observed.title); expect(video.publisher).toBe(observed.authorName);
      expect(video.publishedAt).toBe(observed.publishedAt); expect(video.checkedAt).toBe("2026-10-20");
      expect(video.sourceUrl).toContain(`#gid=${video.id.split(":")[0]}&range=A${video.id.split(":")[1]}:J`);
      expect(new URL(video.url).hostname).toBe("www.youtube.com");
      expect(new URL(video.url).searchParams.get("v")).toMatch(/^[\w-]{11}$/);
      expect(observed.contentReviewed).toBe(false);
      expect(video).not.toHaveProperty("rating"); expect(video).not.toHaveProperty("operatingEvidence");
      expect(video.scope.trim()).not.toBe("");
    }
    expect(SHEET_VIDEOS.filter(v => !v.products.length).every(v => !!v.bindingNote)).toBe(true);
  });

  it("keeps all bindings inside real catalog products and separates manufacturers and modifications", () => {
    const slugs = new Set([...CATALOG, ...VENDOR_CLEANING_PRODUCTS].map(p => p.slug));
    for (const video of CATALOG_VIDEOS) for (const product of video.products) expect(slugs.has(product.slug), product.slug).toBe(true);
    const contains = (slug: string, id: string) => videosForProduct(slug).some(v => v.id === id);
    expect(contains("r2b-mark-2-se", "777001:5")).toBe(false); // Mark 2 is not proven SE.
    expect(contains("waybot-klinbotiks-600", "777001:9")).toBe(false); // Description says 750.
    expect(contains("viggo-sc80", "777001:16")).toBe(false); // PRO is a different model.
    expect(contains("viggo-sc80", "777001:14")).toBe(false);
    expect(contains("avtomakon-ak-sc80", "777001:14")).toBe(true); // Description explicitly says АК-SC80.
    expect(contains("pudu-cc1", "777001:21")).toBe(true); // Description resolves generic PUDU title.
    expect(contains("dikom-dmr-600", "777003:19")).toBe(true);
    expect(contains("dikom-dmr-carrier-p", "777003:19")).toBe(false);
    expect(contains("dikom-dmr-300-carrier-b", "777005:5")).toBe(true);
    expect(contains("evocargo-n1", "777004:11")).toBe(false);
    expect(contains("dikom-dmr-1200", "777003:19")).toBe(false);
    expect(contains("evocargo-n1", "777004:12")).toBe(true);
    expect(contains("evocargo-n1", "777004:13")).toBe(false); // PEK says Evocargo, no N1.
    expect(contains("pudubot-2", "777005:8")).toBe(false);
    expect(contains("pick-by-light", "777005:11")).toBe(false); // SSI SCHAEFER, not UMSERV.
    expect(videosForProduct("nonexistent-product")).toEqual([]);
  });

  it("recognizes customer interviews independently of uploader and keeps named customers within the description's scope", () => {
    for (const id of ["777005:9", "777005:10"]) {
      const video = SHEET_VIDEOS.find(v => v.id === id)!;
      expect(video.kind).toBe("customer-interview"); expect(video.publisher).toBe("UMSERV");
      expect(video.scope).toContain("Андрей Рокшин"); expect(video.scope).toContain("Дикси");
    }
    const customerConference = SHEET_VIDEOS.find(v => v.id === "777004:33")!;
    expect(customerConference.kind).toBe("customer-talk"); expect(customerConference.publisher).toContain("Автомакон");
    expect(customerConference.scope).toContain("Александр Резвин"); expect(customerConference.products).toEqual([]);
    const claimed = SHEET_VIDEOS.find(v => v.id === "777001:5")!;
    expect(claimed.kind).toBe("claimed-review"); expect(claimed.publisher).toContain("R2B");
    expect(claimed.scope).toContain("Кто говорит");
    const pek = SHEET_VIDEOS.find(v => v.id === "777004:13")!;
    expect(pek.kind).toBe("customer-case"); expect(pek.scope).toContain("Бутово");
  });

  it("adds the actual SPI school interview separately from the 65 spreadsheet links, with no inferred economics", () => {
    expect(SCHOOL_CC1_REVIEW).toMatchObject({ origin: "supplemental", platform: "Rutube", kind: "customer-interview", publisher: "SPI robotics", publisherRole: "Интегратор", publishedAt: "2025-07-03" });
    expect(SCHOOL_CC1_REVIEW.scope).toContain("Иван Мальцев"); expect(SCHOOL_CC1_REVIEW.scope).toContain("Wunderpark");
    expect(videosForProduct("pudu-cc1")).toContain(SCHOOL_CC1_REVIEW);
    expect(new Set(CATALOG_VIDEOS.map(v => v.url)).size).toBe(66);
  });
});
