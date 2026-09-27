// Иллюстрации онбординг-тура (public/onboarding/NN-*.svg): по картинке на шаг, в стиле
// ian-xiaohei-illustrations — белый фон, тонкие линии «от руки», чёрный человечек Xiaohei
// делает главное действие шага, редкие подписи: красные — ключевое, оранжевые — путь/стрелки,
// синие — пояснения. Одна сцена — один файл в scenes/, номер файла = номер шага тура.
//
// Запуск (зависимости нужны только здесь, в package.json их нет):
//   npm i --no-save roughjs@4 opentype.js@1
//   node scripts/onboarding-illustrations/build.mjs          # все сцены
//   node scripts/onboarding-illustrations/build.mjs 03 07    # выборочно
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { loadFonts } from "./lib.mjs";

const only = process.argv.slice(2);
const outDir = new URL("../../public/onboarding/", import.meta.url);
mkdirSync(outDir, { recursive: true });
await loadFonts();
for (const f of readdirSync(new URL("./scenes/", import.meta.url)).sort()) {
  if (!f.endsWith(".mjs") || (only.length && !only.some((o) => f.startsWith(o)))) continue;
  const { default: draw } = await import(new URL(`./scenes/${f}`, import.meta.url));
  const svg = draw().svg();
  const name = f.replace(/\.mjs$/, ".svg");
  writeFileSync(new URL(name, outDir), svg);
  console.log(`public/onboarding/${name}  ${(svg.length / 1024).toFixed(1)} KB`);
}
