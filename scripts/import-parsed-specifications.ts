import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import base from "../lib/data/organizer/catalog.generated.json";
import { buildParsedSpecifications, type SpecificationDocument } from "../lib/data/parsed-specifications";
import type { ProductSeed } from "../lib/tz/types";

/** npx tsx scripts/import-parsed-specifications.ts <saved parsed-specs-v2.json> [--check] */
async function main() {
  const input = process.argv[2];
  if (!input || input.startsWith("--")) throw new Error("Provide saved parsed-specs-v2.json; no live network or DB access is used");
  const raw = await readFile(resolve(input));
  const document = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, "")) as SpecificationDocument;
  const output = buildParsedSpecifications(base as unknown as ProductSeed[], document, createHash("sha256").update(raw).digest("hex"));
  const files = [
    [new URL("../lib/data/parsed-specifications.generated.json", import.meta.url), output.runtime],
    [new URL("../lib/data/parsed-specifications.audit.generated.json", import.meta.url), output.audit],
  ] as const;
  for (const [url, value] of files) {
    const expected = `${JSON.stringify(value)}\n`;
    if (process.argv.includes("--check")) {
      if ((await readFile(url, "utf8")).replace(/\r\n/g, "\n") !== expected) throw new Error(`Generated specification data differs: ${fileURLToPath(url)}`);
    } else await writeFile(url, expected, "utf8");
  }
  console.log(JSON.stringify({ version: output.runtime.version, ...output.runtime.summary }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Specification import failed"); process.exitCode = 1; });
