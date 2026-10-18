import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Embed the same immutable engine fingerprint in both compiled deployment artifacts.
let engineFingerprint: string | undefined;
try {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "dist-worker", "engine-release.json"), "utf8"));
  if (!/^alfa-robot\/sha256:[a-f0-9]{64}$/.test(manifest.engineRelease)) throw new Error("Invalid engine manifest");
  engineFingerprint = manifest.engineRelease;
} catch (error) {
  if (process.env.NODE_ENV === "production") throw new Error("Сначала выполните npm run build:worker для этого выпуска", { cause: error });
}

// Dev/HMR needs 'unsafe-eval'; production does not. Next's hydration bootstrap is inline, so
// 'unsafe-inline' for scripts/styles is required until nonce-based CSP is wired up (tracked in
// DEPLOY.md §5). Everything else is same-origin; the canvas scene loads no external resources.
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const demoViewers = [
  { source: "/demo/warehouse", destination: "/warehouse-3d.html" },
  { source: "/demo/cleaning", destination: "/cleaning-3d.html" },
];

const nextConfig: NextConfig = {
  env: engineFingerprint ? { CALCULATION_ENGINE_FINGERPRINT: engineFingerprint } : {},
  // Keep a separately running review build intact while validating a new backend locally.
  distDir: process.env.ALFA_BUILD_DIR ?? ".next",
  // Standalone output is for the Docker image (the runner stage copies `.next/standalone`).
  // It must NOT be set when Vercel builds: their `onBuildComplete` step reads
  // `.next/next-server.js.nft.json`, which standalone mode relocates, and the build dies with
  // `ENOENT ... next-server.js.nft.json` after compiling successfully. Vercel produces its own
  // traced output, so the setting is redundant there as well as fatal.
  output: process.env.VERCEL ? undefined : "standalone",
  // exceljs собирает выгрузку XLSX только на сервере (обработчики маршрутов экспорта проекта).
  // Это CommonJS-пакет с зависимостями на потоки и zip из Node, и его нет в списке пакетов,
  // которые Next сам оставляет внешними (next/dist/lib/server-external-packages.jsonc).
  // Поэтому он не бандлится, а подключается обычным require из node_modules; для standalone-
  // сборки Docker его файлы попадают в .next/standalone через трассировку зависимостей.
  serverExternalPackages: ["exceljs"],
  async rewrites() {
    return { beforeFiles: demoViewers, afterFiles: [], fallback: [] };
  },
  async redirects() {
    return demoViewers.map(route => ({ source: route.destination, destination: route.source, permanent: true }));
  },
  async headers() {
    // Only the self-contained viewers create a local Blob worker from their embedded core.
    const viewerHeaders = securityHeaders.map(header => header.key === "Content-Security-Policy"
      ? { ...header, value: csp.replace("worker-src 'self'", "worker-src 'self' blob:") } : header);
    return [
      { source: "/:path*", headers: securityHeaders },
      ...demoViewers.flatMap(route => [route.source, route.destination].map(source => ({ source, headers: viewerHeaders }))),
    ];
  },
};

export default nextConfig;
