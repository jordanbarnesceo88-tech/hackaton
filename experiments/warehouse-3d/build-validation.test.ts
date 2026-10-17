import { describe, expect, it } from 'vitest';
import { normalizeGeneratedHtml, TEMPLATE_MARKERS, validateOutput, validateTemplate } from './build-validation.mjs';

const template = TEMPLATE_MARKERS.join('\n');
const output = (script = 'const ready = true;', config = '{"initialCase":"complex"}') => `<script type="application/json" id="demo-config">${config}</script><script>${script}</script>`;

describe('standalone 3D build validation', () => {
  it('emits identical LF bytes from equivalent LF and Windows CRLF source text', () => {
    const lf = `${output()}\n<style>\nbody { color: black; }\n</style>\n`;
    expect(normalizeGeneratedHtml(lf.replaceAll('\n', '\r\n'))).toBe(lf);
    expect(normalizeGeneratedHtml(lf)).toBe(lf);
    expect(() => validateOutput(normalizeGeneratedHtml(lf.replaceAll('\n', '\r\n')), 'complex')).not.toThrow();
  });
  it('rejects every missing or duplicated replacement slot before writing artifacts', () => {
    expect(() => validateTemplate(template)).not.toThrow();
    for (const marker of TEMPLATE_MARKERS) {
      expect(() => validateTemplate(template.replace(marker, ''))).toThrow(/exactly one/);
      expect(() => validateTemplate(template + marker)).toThrow(/exactly one/);
    }
  });
  it('parses emitted plain JS and rejects cross-script global lexical collisions', () => {
    expect(() => validateOutput(output(), 'complex')).not.toThrow();
    expect(() => validateOutput(output('const invalid = ;'), 'complex')).toThrow(SyntaxError);
    expect(() => validateOutput(output() + '<script>const ready = false;</script>', 'complex')).toThrow(SyntaxError);
  });
  it('rejects corrupt or wrong-domain JSON, duplicate configs, network scripts and remaining markers', () => {
    expect(() => validateOutput(output('', '{bad'), 'complex')).toThrow();
    expect(() => validateOutput(output('', '{"initialCase":"sections"}'), 'complex')).toThrow(/initialCase/);
    expect(() => validateOutput(output() + output(''), 'complex')).toThrow(/demo-config/);
    expect(() => validateOutput(output() + '<script src="https://example.test/code.js"></script>', 'complex')).toThrow(/offline/);
    expect(() => validateOutput(output('/* APP_CODE */'), 'complex')).toThrow(/unresolved/);
  });
});
