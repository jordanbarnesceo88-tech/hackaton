import { expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { assertSqlDurations, readObservedJson } from './benchmark-contract.mjs';

// Execute the runner's actual phase body with in-memory transports/SQL/clock.
// It stays inside main in production; this test does not import or start main.
const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'run.mjs'), 'utf8');
const start = source.indexOf('  async function phase('), end = source.indexOf('\n  try {', start);
if (start < 0 || end < 0) throw Error('Actual runner phase was not found');
const phaseBody = source.slice(start, end);

function fakePhase(postStatus = 202, invalidJson = false) {
  let now = 0, posts = 0, verificationCalls = 0;
  const files = new Map(), input = { facility: 'warehouse', params: {}, scenarios: [] };
  const out = { criteria: { drainCutoffMs: 10000 }, phases: [], pollSamples: [], errors: [] };
  const client = { index: 3, id: 'separate-owner', request: async (route, init = {}) => {
    if (init.method === 'POST') {
      posts++;
      return { status: postStatus, json: async () => { now = 30; if (invalidJson) throw Error('HTML'); return { job: { id: 'own-job', runId: 'own-run' } }; } };
    }
    if (route.endsWith('/result')) return { status: 200, json: async () => { now = 90; return { job: { id: 'own-job', status: 'SUCCEEDED' } }; } };
    return { status: 200, json: async () => { now = 60; return { job: { id: 'own-job', status: 'SUCCEEDED' } }; } };
  } };
  const db = { query: async sql => ({ rows: sql.includes('EXTRACT(EPOCH') && postStatus === 202 && !invalidJson ? [{ id: 'own-job', runId: 'own-run', status: 'SUCCEEDED', attempts: 1, queueMs: 10, computeAndStoreMs: 20, serverTotalMs: 30 }] : [] }) };
  const verifyResult = async () => { verificationCalls++; now += 1000; return { source: 'actual result' }; };
  const percentiles = values => { const rows = values.filter(Number.isFinite).sort((a,b) => a-b); const at = p => rows[Math.ceil(p * rows.length) - 1] ?? null; return { count: rows.length, p50: at(.5), p95: at(.95), max: at(1) }; };
  const phase = new Function('out', 'save', 'db', 'performance', 'readObservedJson', 'safeError', 'sleep', 'fs', 'path', 'dir', 'sha', 'verifyResult', 'console', 'assertSqlDurations', 'assert', 'run', 'percentiles', 'canonicalJson', phaseBody + ';return phase;')(
    out, () => {}, db, { now: () => now }, readObservedJson, error => ({ name: error.name }), async () => { now += 1000; },
    { writeFileSync: (name, bytes) => files.set(name, bytes), readFileSync: name => files.get(name) }, path, 'external-memory-only', () => 'digest', verifyResult,
    { log: () => {} }, assertSqlDurations, assert, 'one-controlled-run', percentiles, JSON.stringify,
  );
  return { invoke: () => phase('burst', [client], input), counts: () => ({ posts, verificationCalls }), out };
}

it('measures POST through parsed result before independent SQL verification, with one POST', async () => {
  const mocked = fakePhase();
  const result = await mocked.invoke(), row = result.requests[0];
  expect(row.ackMs).toBe(30); expect(row.terminalObservedMs).toBe(60); expect(row.clientResultMs).toBe(90);
  expect(result.summary.clientResultMs.p95).toBe(90); expect(result.functionalPass).toBe(true);
  expect(mocked.counts()).toEqual({ posts: 1, verificationCalls: 1 });
});

it.each([429, 503])('retains first HTTP %s plus decode error and does not retry the POST', async status => {
  const mocked = fakePhase(status, true), result = await mocked.invoke();
  expect(result.requests[0].firstPostStatus).toBe(status);
  expect(result.summary.transportErrors).toBe(0); expect(result.summary.postResponseDecodeErrors).toBe(1);
  expect(result.summary.unexpected5xx).toBe(status === 503 ? 1 : 0);
  expect(result.summary.overload429).toBe(status === 429 ? 1 : 0);
  expect(result.functionalPass).toBe(false); expect(mocked.counts().posts).toBe(1);
});
