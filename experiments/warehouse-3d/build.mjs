import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { normalizeGeneratedHtml, validateTemplate, validateOutput } from './build-validation.mjs';

const checkOnly = process.argv.slice(2).includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node build.mjs [--check]');

const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, '../..');
const cache = path.resolve(repo, '../research/alfa-audit/three-r128');
await mkdir(cache, { recursive: true });
const libraries = ['build/three.min.js', 'examples/js/shaders/CopyShader.js', 'examples/js/shaders/FXAAShader.js', 'examples/js/postprocessing/EffectComposer.js', 'examples/js/postprocessing/RenderPass.js', 'examples/js/postprocessing/ShaderPass.js', 'examples/js/controls/OrbitControls.js'];
let license;
try { license = await readFile(path.join(cache, 'LICENSE'), 'utf8'); }
catch {
  const response = await fetch('https://cdn.jsdelivr.net/npm/three@0.128.0/LICENSE');
  if (!response.ok) throw new Error(`Three.js license: HTTP ${response.status}`);
  license = await response.text();
  await writeFile(path.join(cache, 'LICENSE'), license, 'utf8');
}
const inline = value => value.replace(/<\/script/gi, '<\\/script');
const sources = await Promise.all(libraries.map(async name => {
  const local = path.join(cache, name.replaceAll('/', '_'));
  let source;
  try { source = await readFile(local, 'utf8'); }
  catch {
    const response = await fetch(`https://cdn.jsdelivr.net/npm/three@0.128.0/${name}`);
    if (!response.ok) throw new Error(`Three.js ${name}: HTTP ${response.status}`);
    source = await response.text();
    await writeFile(local, source, 'utf8');
  }
  return `<script>/* Three.js r128, MIT license. https://github.com/mrdoob/three.js/tree/r128 — ${name} */\n${inline(source)}</script>`;
}));
const core = await build({ entryPoints: [path.join(dir, 'core.ts')], bundle: true, write: false, format: 'iife', globalName: 'WarehouseDemoCore', platform: 'browser', target: 'es2020', minify: true, legalComments: 'inline' });
const [template, scene, app, detail, history, panel, panelCss, incidents, incidentCss, assessment, comparison] = await Promise.all(['index.html', 'scene.js', 'app.js', 'robot-detail.js', 'robot-history.js', 'robot-panel.js', 'robot-panel.css', 'incident-panel.js', 'incident-panel.css', 'assessment-panel.js', 'comparison-panel.js'].map(name => readFile(path.join(dir, name), 'utf8')));
validateTemplate(template);
const photos = {};
for (const [kind, file, mime] of [['warehouse', 'ronavi-h1500.jpg', 'image/jpeg'], ['cleaning', 'pudu-cc1.png', 'image/png']]) {
  photos[kind] = `data:${mime};base64,${(await readFile(path.join(dir, 'assets', file))).toString('base64')}`;
}
const financeControls = await readFile(path.join(dir, 'finance-controls.js'), 'utf8');
const html = template.replace('</style>', () => `${panelCss}\n${incidentCss}\n.field select,.field textarea{width:100%;min-width:0;min-height:38px;padding:7px 9px;border:1px solid #aebfc0;border-radius:4px;background:#fcfdfd;font:inherit;color:inherit}.field textarea:focus-visible{outline:3px solid #ce8d27;outline-offset:3px}#finance-form details{margin:16px 0;padding:12px 0;border-block:1px solid var(--line)}#finance-form details summary{cursor:pointer;font-weight:600}#finance-form details>.note{display:block;margin-block:12px}\n</style>`).replace('<!-- VENDOR_SCRIPTS -->', () => `<!-- Three.js r128 license:\n${license}\n-->\n${sources.join('\n')}`).replace('/* CORE_BUNDLE */', () => inline(core.outputFiles[0].text)).replace('/* SCENE_CODE */', () => inline(scene)).replace('/* APP_CODE */', () => `${inline(detail)}\n${inline(history)}\n${inline(panel)}\n${inline(incidents)}\n${inline(assessment)}\n${inline(comparison)}\n${inline(financeControls)}\nwindow.RobotReferencePhotos=${JSON.stringify(photos)};\n${inline(app)}`);
// Validate both domains before touching either published artifact.
const outputs = [];
for (const [name, initialCase] of [['warehouse-3d.html', 'steady-flow'], ['cleaning-3d.html', 'sections']]) {
  const output = normalizeGeneratedHtml(html.replace('"initialCase":null', `"initialCase":"${initialCase}"`));
  validateOutput(output, initialCase);
  const out = path.join(repo, 'public', name);
  outputs.push({ out, output });
}
if (checkOnly) {
  for (const { out, output } of outputs) {
    let existing;
    try { existing = await readFile(out, 'utf8'); } catch { throw new Error(`Missing generated 3D artifact: ${out}; run npm run build:3d`); }
    if (existing !== output) throw new Error(`Stale generated 3D artifact: ${out}; run npm run build:3d`);
    console.log(`Verified ${out} (${Buffer.byteLength(output)} bytes)`);
  }
} else {
  await mkdir(path.join(repo, 'public'), { recursive: true });
  for (const { out, output } of outputs) {
    const temporary = `${out}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, output, 'utf8');
      await rename(temporary, out);
    } finally { await rm(temporary, { force: true }); }
    console.log(`${out} (${Buffer.byteLength(output)} bytes); offline HTML, Three.js r128 included`);
  }
}
