import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('production spatial runtime dependency boundary', () => {
  it('keeps the server replay entry independent of React, WebGL and browser UI packages', async () => {
    const bundle = await build({ entryPoints: ['lib/sim/spatial-server.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', metafile: true });
    const inputs = Object.keys(bundle.metafile!.inputs);
    // This intentionally bundles the production adapter, not core.ts: the standalone
    // viewer is allowed to carry the catalogue, UI and browser-specific orchestration.
    expect(inputs).toContain('experiments/warehouse-3d/project-input.ts');
    expect(inputs.filter(file => /(?:^|\/)(?:node_modules|scene\.js|app\.js|core\.ts)(?:\/|$)/.test(file))).toEqual([]);
    expect(inputs.filter(file => /\.(?:tsx|jsx)$/.test(file))).toEqual([]);
    expect(Object.values(bundle.metafile!.inputs).flatMap(input => input.imports).filter(entry => entry.external && !entry.path.startsWith('node:'))).toEqual([]);
  });
});
