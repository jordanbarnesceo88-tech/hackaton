import { parseServiceProviderList, type ServiceProvider } from "../implementation/service-directory";

/** A declared contract SLA cannot be inherited from an unconfirmed catalogue record. */
export function parseServiceCharacteristic(raw: unknown, confirmed: boolean): ServiceProvider[] {
  const providers = parseServiceProviderList(raw);
  if (!confirmed && providers.some(p => p.verification === "contract-reference" || p.responseSla || p.onsiteSla)) throw new Error("Договорные условия сервиса и SLA требуют подтверждения записи");
  return confirmed ? providers : providers.map(p => ({ ...p, verification: "team-reference" as const }));
}

export function serviceOverridesOf(chars: readonly { key: string; valueText: string | null; confirmed: boolean }[]): ServiceProvider[] | undefined {
  const row = chars.find(c => c.key === "serviceProviders");
  if (!row) return undefined;
  try { return parseServiceCharacteristic(row.valueText, row.confirmed); }
  catch { return []; } // Explicitly invalid contacts must not silently select a different provider.
}
