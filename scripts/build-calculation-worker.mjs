import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const options = {
  entryPoints: ["scripts/calculation-worker.ts"],
  outfile: "dist-worker/calculation-worker.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  sourcemap: false,
};

// Follow the actual executable dependency graph, including shared geometry modules.
const probe = await build({ ...options, write: false, metafile: true, logLevel: "silent" });
const paths = [...new Set([...Object.keys(probe.metafile.inputs), "prisma/schema.prisma",
  "package-lock.json", "scripts/build-calculation-worker.mjs"])]
  .map(path => path.replaceAll("\\", "/")).sort();
const hash = createHash("sha256");
for (const path of paths) hash.update(path).update("\0").update(await readFile(path)).update("\0");
// Compiler settings affect emitted code; generated Next tsconfig includes do not.
const compiledProbeSha256 = createHash("sha256").update(probe.outputFiles[0].contents).digest("hex");
hash.update("compiled-probe\0").update(compiledProbeSha256);
await mkdir("dist-worker", { recursive: true });
const fingerprint = `alfa-robot/sha256:${hash.digest("hex")}`;
await build({
  ...options,
  define: { "process.env.CALCULATION_ENGINE_FINGERPRINT": JSON.stringify(fingerprint) },
  logLevel: "info",
});
await writeFile("dist-worker/engine-release.json", JSON.stringify({ engineRelease: fingerprint, sources: paths, compiledProbeSha256 }, null, 2) + "\n");
