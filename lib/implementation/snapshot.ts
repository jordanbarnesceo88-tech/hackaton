import { implementationGuide, IMPLEMENTATION_VERSION, type ImplementationGuide } from "./guides";
import { parseServiceProviderList, serviceProviders, type ServiceProvider } from "./service-directory";

export type ImplementationSnapshot = {
  version: string;
  guide: ImplementationGuide | null;
  providers: ServiceProvider[];
};

/** Freeze guidance and contact provenance with the product, so archives never adopt live directory edits. */
export function buildImplementationSnapshot(solutionType: string, manufacturer: string | null, providers?: ServiceProvider[]): ImplementationSnapshot {
  return { version: IMPLEMENTATION_VERSION, guide: implementationGuide(solutionType), providers: providers === undefined ? serviceProviders(solutionType, manufacturer) : parseServiceProviderList(providers) };
}
