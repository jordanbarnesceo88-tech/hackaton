// Иллюстрации продукта — рисунки в стиле ian-xiaohei-illustrations: белый фон, тонкие линии
// «от руки», чёрный человечек Xiaohei делает главное действие, редкие подписи: красные —
// ключевое, оранжевые — путь и стрелки, синие — пояснения.
//
// scenes/<набор>/NN-*.mjs → public/<набор>/NN-*.svg; одна сцена — один файл:
//   onboarding  — восемь шагов тура (components/onboarding/onboarding-tour.tsx);
//   methodology — карта расчёта и разделы страницы /methodology/tz.
// Сцена с кликабельными областями (s.hotspots) пишет рядом ещё и NN-*.json.
//
// Запуск (зависимости нужны только здесь, в package.json их нет):
//   npm i --no-save roughjs@4 opentype.js@1
//   node scripts/illustrations/build.mjs                       # всё
//   node scripts/illustrations/build.mjs methodology onboarding/03
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { loadFonts } from "./lib.mjs";

const only = process.argv.slice(2);
await loadFonts();
const scenesDir = new URL("./scenes/", import.meta.url);
for (const set of readdirSync(scenesDir).sort()) {
  const outDir = new URL(`../../public/${set}/`, import.meta.url);
  for (const f of readdirSync(new URL(`${set}/`, scenesDir)).sort()) {
    const id = `${set}/${f.replace(/\.mjs$/, "")}`;
    if (!f.endsWith(".mjs") || (only.length && !only.some((o) => id.startsWith(o)))) continue;
    mkdirSync(outDir, { recursive: true });
    const { default: draw } = await import(new URL(`${set}/${f}`, scenesDir));
    const scene = draw();
    const svg = scene.svg();
    writeFileSync(new URL(`${id.split("/")[1]}.svg`, outDir), svg);
    console.log(`public/${id}.svg  ${(svg.length / 1024).toFixed(1)} KB`);
    if (scene.hotspots) {
      const json = JSON.stringify({ width: scene.w, height: scene.h, hotspots: scene.hotspots }, null, 2) + "\n";
      writeFileSync(new URL(`${id.split("/")[1]}.json`, outDir), json);
      console.log(`public/${id}.json  ${scene.hotspots.length} hotspots`);
    }
  }
}
