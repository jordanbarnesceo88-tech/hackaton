import { describe, expect, it } from 'vitest';
import { PROJECT_INPUT_MAX_BYTES, projectInputJsonBytes, projectInputSizeIssue } from './payload-limit';
import { readJsonBody } from '../api/http';

describe('bounded aggregate project input', () => {
  it('admits the measured 2.43 MB ten-scenario class, with a finite 4 MiB boundary', () => {
    expect(projectInputSizeIssue({ scenarios: [{ proof: 'x'.repeat(2_433_182) }] })).toBeNull();
    expect(projectInputSizeIssue('x'.repeat(PROJECT_INPUT_MAX_BYTES - 2))).toBeNull();
    expect(projectInputSizeIssue('x'.repeat(PROJECT_INPUT_MAX_BYTES - 1))).toMatch(/4 МиБ/);
  });
  it('counts UTF-8 bytes rather than string characters in Node and the browser', () => {
    expect(projectInputJsonBytes({ text: 'Робот 🤖' })).toBe(Buffer.byteLength(JSON.stringify({ text: 'Робот 🤖' })));
    expect(projectInputSizeIssue('я'.repeat(2_100_000))).toMatch(/4 МиБ/);
  });
  it('rejects silently lossy non-finite numbers, cycles and non-JSON values without throwing at the caller', () => {
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    for (const value of [cycle, { n: NaN }, { n: Infinity }, { n: BigInt(1) }, undefined]) expect(projectInputSizeIssue(value)).toMatch(/JSON/);
    // Size admission deliberately leaves malformed domain data to the existing validator.
    expect(projectInputSizeIssue({ scenarios: 'not a scenario array' })).toBeNull();
  });
  it('allows 2.43 MB through the same streaming API reader while refusing over-cap requests', async () => {
    const request = (count: number) => new Request('http://localhost/api/v1/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(count) }) });
    expect((await readJsonBody(request(2_433_182), PROJECT_INPUT_MAX_BYTES)).ok).toBe(true);
    const rejected = await readJsonBody(request(PROJECT_INPUT_MAX_BYTES), PROJECT_INPUT_MAX_BYTES);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.response.status).toBe(413);
  });
});
