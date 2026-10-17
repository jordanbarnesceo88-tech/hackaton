import { Script } from 'node:vm';

export const TEMPLATE_MARKERS = ['</style>', '<!-- VENDOR_SCRIPTS -->', '/* CORE_BUNDLE */', '/* SCENE_CODE */', '/* APP_CODE */', '"initialCase":null'];

/** Git may check source text out as CRLF on Windows. Generated offline artifacts
 * always use LF so --check and release digests are portable across checkout styles. */
export function normalizeGeneratedHtml(html) {
  return html.replace(/\r\n/g, '\n');
}

/** Replacements are deliberate build slots, never a best-effort HTML transformation. */
export function validateTemplate(template) {
  for (const marker of TEMPLATE_MARKERS) {
    const count = template.split(marker).length - 1;
    if (count !== 1) throw new Error(`3D template: expected exactly one ${JSON.stringify(marker)}, found ${count}`);
  }
}

/** Parse the exact emitted code, including plain JS modules that esbuild does not consume. */
export function validateOutput(html, initialCase) {
  for (const marker of TEMPLATE_MARKERS.slice(1)) {
    if (html.includes(marker)) throw new Error(`3D output: unresolved build marker ${marker}`);
  }
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const configs = scripts.filter(match => /\bid\s*=\s*["']demo-config["']/i.test(match[1]));
  if (configs.length !== 1) throw new Error('3D output: expected exactly one demo-config');
  const config = JSON.parse(configs[0][2]);
  if (config.initialCase !== initialCase) throw new Error(`3D output: expected initialCase ${initialCase}`);
  const code = [];
  for (const [index, match] of scripts.entries()) {
    if (/\btype\s*=\s*["']application\/json["']/i.test(match[1])) continue;
    if (/\bsrc\s*=/i.test(match[1])) throw new Error('3D output must contain offline inline scripts only');
    new Script(match[2], { filename: `3D-inline-${index + 1}.js` });
    code.push(match[2]);
  }
  // Classic script tags share a global lexical environment. Individually valid scripts can
  // still fail on a duplicate top-level const/let declaration in a later tag.
  new Script(code.join('\n;\n'), { filename: '3D-all-classic-scripts.js' });
  if (!code.length) throw new Error('3D output contains no executable scripts');
}
