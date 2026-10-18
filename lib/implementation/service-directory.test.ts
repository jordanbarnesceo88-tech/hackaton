import { describe, expect, it } from "vitest";
import { parseServiceProviderList, serviceProviders, serviceProvidersText } from "./service-directory";

describe("product-specific service directory input", () => {
  const fixture = () => serviceProviders("pallet-amr", "Ronavi")[0]!;
  it("accepts sourced contacts, and contract SLA only with its reference", () => {
    const provider = { ...fixture(), verification: "contract-reference", sourceRef: "Договор №1, участок А, приложение SLA", responseSla: "30 минут", onsiteSla: "Следующий рабочий день" };
    expect(parseServiceProviderList(JSON.stringify([provider]))[0]).toEqual(provider);
    expect(serviceProvidersText([provider])).toContain("Договор №1");
    expect(parseServiceProviderList([])).toEqual([]);
  });

  it.each([
    { sourceUrl: "javascript:alert(1)" }, { contactUrl: "https://user:password@example.org" }, { contactUrl: "http://example.org" },
    { checkedAt: "2026-02-30" }, { sourceUrl: null, sourceRef: null }, { email: "address\r\nBcc: hidden@example.org" },
    { responseSla: "15 минут" }, { verification: "contract-reference", sourceRef: null }, { other: "unknown" },
  ])("rejects an ungrounded promise or malformed contact %#", override => {
    expect(() => parseServiceProviderList([{ ...fixture(), ...override }])).toThrow();
  });

  it("rejects duplicate organisations and oversized imported lists", () => {
    expect(() => parseServiceProviderList([fixture(), fixture()])).toThrow();
    expect(() => parseServiceProviderList(Array.from({ length: 6 }, (_, i) => ({ ...fixture(), id: `provider-${i}` })))).toThrow();
    expect(() => parseServiceProviderList(" ".repeat(16001))).toThrow();
  });
});
