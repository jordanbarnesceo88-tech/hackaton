export type ServiceProvider = {
  id: string;
  name: string;
  role: string;
  coverage: string;
  responseSla: string | null;
  onsiteSla: string | null;
  contactUrl: string | null;
  email: string | null;
  phone: string | null;
  sourceUrl: string | null;
  sourceRef: string | null;
  checkedAt: string;
  verification: "public-source" | "team-reference" | "contract-reference";
};

export const SERVICE_PROVIDERS_MAX_CHARS = 16_000;
const FIELDS = new Set(["id", "name", "role", "coverage", "responseSla", "onsiteSla", "contactUrl", "email", "phone", "sourceUrl", "sourceRef", "checkedAt", "verification"]);

function httpsUrl(value: string | null): string | null {
  if (value === null) return null;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Сервис: некорректная ссылка"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Сервис: нужна HTTPS-ссылка без учётных данных");
  return value;
}

/** An administrator may attach contacts to a specific product; private SLA terms require a contract reference. */
export function parseServiceProviderList(raw: unknown): ServiceProvider[] {
  if (typeof raw === "string") {
    if (raw.length > SERVICE_PROVIDERS_MAX_CHARS) throw new Error("Сведения сервиса слишком велики");
    try { raw = JSON.parse(raw); } catch { throw new Error("Сведения сервиса должны быть JSON-массивом"); }
  }
  if (!Array.isArray(raw) || raw.length > 5) throw new Error("Сервис: укажите массив не более пяти организаций");
  const ids = new Set<string>();
  return raw.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Сервис: организация должна быть объектом");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !FIELDS.has(key))) throw new Error("Сервис: неизвестные поля организации");
    const text = (key: string, max: number, nullable = false): string | null => {
      if (nullable && row[key] === null) return null;
      if (typeof row[key] !== "string" || !row[key].trim() || row[key].length > max || /[\u0000-\u001f]/.test(row[key])) throw new Error(`Сервис: проверьте поле ${key}`);
      return row[key].trim();
    };
    const id = text("id", 80)!;
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || ids.has(id)) throw new Error("Сервис: идентификаторы организаций должны быть уникальны");
    ids.add(id);
    const verification = row.verification;
    if (verification !== "public-source" && verification !== "team-reference" && verification !== "contract-reference") throw new Error("Сервис: укажите происхождение сведений");
    const sourceUrl = httpsUrl(text("sourceUrl", 2000, true)), sourceRef = text("sourceRef", 1000, true);
    if (!sourceUrl && !sourceRef) throw new Error("Сервис: нужен источник сведений");
    if (verification === "public-source" && !sourceUrl) throw new Error("Сервис: для открытого источника нужна ссылка");
    if (verification === "contract-reference" && !sourceRef) throw new Error("Сервис: нужен номер или ссылка на договор и его область действия");
    const responseSla = text("responseSla", 500, true), onsiteSla = text("onsiteSla", 500, true);
    if ((responseSla || onsiteSla) && verification !== "contract-reference") throw new Error("Сервис: SLA задаётся только со ссылкой на договор для объекта");
    const checkedAt = text("checkedAt", 10)!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) || !Number.isFinite(Date.parse(checkedAt)) || new Date(checkedAt).toISOString().slice(0, 10) !== checkedAt) throw new Error("Сервис: неверная дата проверки");
    const email = text("email", 254, true), phone = text("phone", 60, true);
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error("Сервис: неверный email");
    if (phone && !/^\+?[0-9 ()-]{5,60}$/.test(phone)) throw new Error("Сервис: неверный телефон");
    return { id, name: text("name", 200)!, role: text("role", 500)!, coverage: text("coverage", 1000)!, responseSla, onsiteSla,
      contactUrl: httpsUrl(text("contactUrl", 2000, true)), email, phone, sourceUrl, sourceRef, checkedAt, verification };
  });
}

export function serviceProvidersText(raw: unknown): string {
  try {
    const list = parseServiceProviderList(raw);
    return list.length ? list.map(provider => `${provider.name}: ${provider.role}; ${provider.coverage}. Реакция: ${provider.responseSla ?? "не согласована"}; выезд: ${provider.onsiteSla ?? "не согласован"}. Контакт: ${provider.contactUrl ?? provider.email ?? provider.phone ?? "не предоставлен"}. Источник: ${[provider.sourceUrl, provider.sourceRef].filter(Boolean).join("; ")}; проверка ${provider.checkedAt}.`).join("\n") : "Контакты обслуживания не назначены.";
  } catch { return "Сведения сервиса некорректны; запросите актуальные контакты и условия."; }
}

const providers: { ronavi: ServiceProvider; spi: ServiceProvider; alfa: ServiceProvider } = {
  ronavi: {
    id: "ronavi", name: "Ronavi Robotics", role: "Производитель и внедрение логистических роботов",
    coverage: "Поддержка по России заявлена поставщиком; выезд на конкретный объект согласовать.",
    responseSla: null, onsiteSla: null, contactUrl: "https://ronavi-robotics.ru/about", email: null, phone: null,
    sourceUrl: "https://ronavi-robotics.ru/about", sourceRef: null, checkedAt: "2026-10-18", verification: "public-source",
  },
  spi: {
    id: "spi", name: "SPI robotics", role: "Послепродажное обслуживание Pudu",
    coverage: "Россия; на сайте указаны офисы в Москве и Воронеже. Географию выезда уточнить.",
    responseSla: null, onsiteSla: null, contactUrl: "https://pudurobots.ru/support", email: "support@pudurobots.ru", phone: "8 800 511 45 35",
    sourceUrl: "https://pudurobots.ru/support", sourceRef: null, checkedAt: "2026-10-18", verification: "public-source",
  },
  alfa: {
    id: "alfa-service", name: "Альфа-Сервис", role: "Клининг и организация пилота — сведения команды",
    coverage: "Территорию и обслуживаемые модели согласовать с командой.",
    responseSla: null, onsiteSla: null, contactUrl: null, email: null, phone: null,
    sourceUrl: null, sourceRef: "Бэклог команды от 18.10.2026, пункт 34: по клинингу — Альфа-Сервис", checkedAt: "2026-10-18", verification: "team-reference",
  },
};

/** Match manufacturer tokens, never a loose substring or the product's marketing name. */
export function serviceProviders(solutionType: string, manufacturer: string | null): ServiceProvider[] {
  const words = new Set((manufacturer ?? "").toLocaleLowerCase("ru").split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const selected: ServiceProvider[] = [];
  if (["ronavi", "ронави"].some(word => words.has(word))) selected.push(providers.ronavi);
  if (["pudu", "pudurobotics"].some(word => words.has(word))) selected.push(providers.spi);
  if (solutionType === "cleaner") selected.push(providers.alfa);
  return parseServiceProviderList(structuredClone(selected));
}
