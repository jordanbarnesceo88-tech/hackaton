import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertIsolatedDatabase } from './isolation.mjs';
import { assertSqlDurations, assertContainerUnchanged, readObservedJson } from './benchmark-contract.mjs';
import { CONTOUR, parseDeclaredWorkers, workerNames, containerSuffixes, assertQueuePolicy, assertWorkerStartup, assertProfile, assertFrozenRequest, catalogueSignature, declaredResources, assertExternalReportDirectory, assertAppPort, serviceNetwork, assertServiceNames, assertServiceTopology } from './declaration.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = 'alfa-robot/sha256:' + 'a'.repeat(64) + '/durable-stage3';
const log = `calculation_worker_started engine=${engine} instance=worker:9 concurrency=1 globalCap=12 dbPoolMax=2 policy=database`;
const profile = () => ({ schema: 'stage3-load-profile-1', versions: { economics: 'tz-test', analytical: 'sim-test', spatial: 'spatial-test' },
  initial: { facility: 'warehouse', params: {}, scenarios: [{ key: 'asis', kind: 'asis', items: [] }, ...['purchase', 'raas'].map(kind => ({ key: kind, kind, items: [{ productSlug: 'ronavi-h1500', process: 'pallet-transport', quantityOverride: 6, chargersOverride: 2 }] }))] }, catalogueSha256: 'a'.repeat(64),
  declaredCase: { fleet: 6, chargers: 2, seed: 1, requiredPerH: 51.81818181818182, sourceInputKeySha256: 'b'.repeat(64) } });

describe('one fixed isolated scaled load contour', () => {
  it.each([['12', 12], ['14', 14]])('accepts only explicit declared workers %s', (value, workers) => {
    expect(parseDeclaredWorkers(value)).toBe(workers);
    expect(workerNames(workers)).toHaveLength(workers);
    expect(containerSuffixes(workers)).toHaveLength(workers + 1);
    expect(assertQueuePolicy([{ id: 1, maxActive: workers }], workers).maxActive).toBe(workers);
    expect(assertWorkerStartup(log.replace('globalCap=12', 'globalCap=' + workers), engine, workers).globalCap).toBe(workers);
    assertServiceNames([CONTOUR.project + '-app-1'], workerNames(workers), workers);
  });
  it.each([undefined, '', ' 12', '14 ', '12.0', '1.4e1', '13', '11', '15', 12, 14, ['14'], null])('rejects an implicit or undeclared capacity %j', value => {
    expect(() => parseDeclaredWorkers(value)).toThrow();
  });
  it.each([12, 14])('does not mix worker count, database policy, startup or resources at %s', workers => {
    const other = workers === 12 ? 14 : 12;
    expect(() => assertQueuePolicy([{ id: 1, maxActive: other }], workers)).toThrow();
    expect(() => assertWorkerStartup(log.replace('globalCap=12', 'globalCap=' + other), engine, workers)).toThrow();
    expect(() => assertServiceNames([CONTOUR.project + '-app-1'], workerNames(other), workers)).toThrow();
    const host = { logicalCpu: 32 }, docker = { cpus: 32 };
    const declaration = { schema: 'stage3-load-resources-1', host, docker, containers: Object.fromEntries(containerSuffixes(workers).map(suffix => [CONTOUR.project + '-' + suffix, {}])) };
    declaredResources(declaration, host, docker, workers);
    expect(() => declaredResources(declaration, host, docker, other)).toThrow();
    delete declaration.containers[CONTOUR.project + '-worker-' + workers];
    expect(() => declaredResources(declaration, host, docker, workers)).toThrow();
  });
  it('capacity helpers reject a missing or arbitrary expected count', () => {
    for (const workers of [undefined, 13, '14']) {
      expect(() => workerNames(workers)).toThrow();
      expect(() => assertQueuePolicy([{ id: 1, maxActive: 14 }], workers)).toThrow();
      expect(() => assertWorkerStartup(log, engine, workers)).toThrow();
      expect(() => assertServiceNames([CONTOUR.project + '-app-1'], workerNames(14), workers)).toThrow();
    }
  });
  it('pins all sixteen network members for declared14 and rejects a missing or extra worker', () => {
    const id = 'a'.repeat(64), name = CONTOUR.project + '_default';
    const selected = suffix => ({ id: suffix, name: CONTOUR.project + '-' + suffix, network: { id, name, aliases: [suffix === 'db-1' ? 'db' : suffix] } });
    const containers = containerSuffixes(14).map(selected), database = selected('db-1');
    const network = { Id: id, Name: name, Containers: Object.fromEntries([...containers, database].map(row => [row.id, { Name: row.name }])) };
    expect(assertServiceTopology(containers, database, network).members).toHaveLength(16);
    const missing = structuredClone(network); delete missing.Containers['worker-14'];
    expect(() => assertServiceTopology(containers, database, missing)).toThrow();
    const extra = structuredClone(network); extra.Containers['worker-15'] = { Name: CONTOUR.project + '-worker-15' };
    expect(() => assertServiceTopology(containers, database, extra)).toThrow();
  });
  it('accepts only the exact database routing used by pg', () => {
    expect(assertIsolatedDatabase('postgresql://fixture:ephemeral@127.0.0.1:55440/alfa_queue_scaled')).toEqual({ host: '127.0.0.1', port: 55440, database: 'alfa_queue_scaled' });
  });
  it.each([
    'postgresql://fixture:ephemeral@127.0.0.1:55436/alfa_queue_scaled',
    'postgresql://fixture:ephemeral@127.0.0.1:55438/alfa_queue_scaled',
    'postgresql://fixture:ephemeral@localhost:55440/alfa_queue_scaled',
    'postgresql://fixture:ephemeral@127.0.0.1:55440/robotization_roi',
    'postgresql://fixture:ephemeral@127.0.0.1:55440/alfa_queue_scaled?port=55436',
    'postgresql://fixture:ephemeral@127.0.0.1:55440/alfa_queue_scaled?host=127.0.0.1',
    'postgresql://fixture:ephemeral@127.0.0.1:55440/alfa_queue_scaled?options=-c%20search_path=public',
    'postgresql://fixture:ephemeral@127.0.0.1:55440/alfa_queue_scaled#route',
    'https://127.0.0.1:55440/alfa_queue_scaled',
  ])('rejects another route before connecting: %s', dsn => expect(() => assertIsolatedDatabase(dsn)).toThrow());

  it('requires a real singleton cap12 and actual pool2 worker startup', () => {
    expect(assertQueuePolicy([{ id: 1, maxActive: 12 }], 12)).toEqual({ id: 1, maxActive: 12 });
    expect(assertWorkerStartup(log, engine, 12)).toMatchObject({ globalCap: 12, dbPoolMax: 2, concurrency: 1 });
    expect(workerNames(12)).toHaveLength(12);
  });
  it('binds the HTTP origin to the single inspected app', () => {
    assertAppPort({ NetworkSettings: { Ports: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3087' }] } } });
    for (const HostPort of ['3085', '3086', '3999']) expect(() => assertAppPort({ NetworkSettings: { Ports: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort }] } } })).toThrow();
    expect(() => assertAppPort({ NetworkSettings: { Ports: { '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '3087' }] } } })).toThrow();
    assertServiceNames([CONTOUR.project + '-app-1'], workerNames(12), 12);
    expect(() => assertServiceNames([CONTOUR.project + '-app-1', CONTOUR.project + '-app-2'], workerNames(12), 12)).toThrow();
  });
  it('pins the real database target and only fourteen network identities', () => {
    const id = 'a'.repeat(64), name = CONTOUR.project + '_default';
    const selected = (suffix, alias) => ({ id: suffix, name: CONTOUR.project + '-' + suffix, network: { id, name, address: '172.20.0.2', aliases: [alias] } });
    const containers = [selected('app-1', 'app'), ...workerNames(12).map((_, i) => selected('worker-' + (i + 1), 'worker'))], database = selected('db-1', 'db');
    const network = { Id: id, Name: name, Containers: Object.fromEntries([...containers, database].map(row => [row.id, { Name: row.name }])) };
    expect(assertServiceTopology(containers, database, network).members).toHaveLength(14);
    const otherNetwork = structuredClone(containers); otherNetwork[0].network.id = 'b'.repeat(64);
    expect(() => assertServiceTopology(otherNetwork, database, network)).toThrow();
    const shadow = structuredClone(containers); shadow[0].network.aliases.push('db');
    expect(() => assertServiceTopology(shadow, database, network)).toThrow();
    const rogue = structuredClone(network); rogue.Containers.rogue = { Name: 'another-app-or-db' };
    expect(() => assertServiceTopology(containers, database, rogue)).toThrow();
    const missing = structuredClone(network); delete missing.Containers['worker-12'];
    expect(() => assertServiceTopology(containers, database, missing)).toThrow();
    expect(serviceNetwork({ NetworkSettings: { Networks: { [name]: { NetworkID: id, IPAddress: '172.20.0.2', Aliases: ['worker'] } } } })).toMatchObject({ id, name });
    expect(() => serviceNetwork({ NetworkSettings: { Networks: { wrong: { NetworkID: id, IPAddress: '172.20.0.2' } } } })).toThrow();
  });
  it.each([[], [{ id: 1, maxActive: 2 }], [{ id: 2, maxActive: 12 }], [{ id: 1, maxActive: 12 }, { id: 2, maxActive: 12 }]])('rejects an untrue database policy', rows => expect(() => assertQueuePolicy(rows, 12)).toThrow());
  it.each([
    log.replace('globalCap=12', 'globalCap=2'), log.replace('dbPoolMax=2', 'dbPoolMax=10'), log.replace('policy=database', 'policy=env'),
    log.replace('concurrency=1', 'concurrency=2'), log.replace('engine=' + engine, 'engine=old'), log + '\n' + log, log + ' dbPoolMax=2', '',
  ])('rejects a wrong or ambiguous worker startup', line => expect(() => assertWorkerStartup(line, engine, 12)).toThrow());

  it('rejects profile retuning and old profile schemas', () => {
    assertProfile(profile());
    for (const [field, value] of [['fleet', 60], ['chargers', 3], ['seed', 2], ['requiredPerH', 50]]) {
      const changed = profile(); changed.declaredCase[field] = value;
      expect(() => assertProfile(changed)).toThrow();
    }
    const old = profile(); old.schema = 'stage2-load-profile-1'; expect(() => assertProfile(old)).toThrow();
    const implicitFleet = profile(); delete implicitFleet.initial.scenarios[1].items[0].quantityOverride;
    expect(() => assertProfile(implicitFleet)).toThrow();
    const missingRaas = profile(); missingRaas.initial.scenarios.pop(); expect(() => assertProfile(missingRaas)).toThrow();
  });
  it('rejects stripping request fields or changing the frozen catalogue', () => {
    const request = { facility: 'warehouse', params: { area: 5000 }, scenarios: [{ key: 'purchase', items: [], spatialEvidence: { capacityRequested: true, sourceInputKey: 'actual source' } }] };
    const live = { products: [{ slug: 'ronavi-h1500', manufacturer: 'Ronavi' }], norms: { rate: .12 }, paramDefs: [{ key: 'area' }] };
    const declared = profile(); declared.catalogueSha256 = catalogueSignature(live);
    const frozen = { schemaVersion: 1, operation: 'CALCULATE', input: structuredClone(request), live };
    assertFrozenRequest(frozen, request, declared);
    const stripped = structuredClone(frozen); delete stripped.input.scenarios[0].spatialEvidence;
    expect(() => assertFrozenRequest(stripped, request, declared)).toThrow();
    const changed = structuredClone(frozen); changed.live.norms.rate = 0;
    expect(() => assertFrozenRequest(changed, request, declared)).toThrow();
  });

  it('requires exact CPU/RAM declarations and all thirteen compute containers', () => {
    const host = { cpuModel: 'fixed CPU', logicalCpu: 32, ramBytes: 128 }, docker = { cpus: 32, memoryBytes: 32 };
    const declaration = { schema: 'stage3-load-resources-1', host, docker, containers: Object.fromEntries([`${CONTOUR.project}-app-1`, ...workerNames(12)].map(name => [name, {}])) };
    declaredResources(declaration, host, docker, 12);
    expect(() => declaredResources(declaration, { ...host, logicalCpu: 16 }, docker, 12)).toThrow();
    expect(() => declaredResources(declaration, host, { ...docker, memoryBytes: 64 }, 12)).toThrow();
    const missing = structuredClone(declaration); delete missing.containers[workerNames(12)[11]];
    expect(() => declaredResources(missing, host, docker, 12)).toThrow();
  });
  it('rejects resource/image/start drift and invalid SQL durations', () => {
    const before = { id: 'fixed', image: 'sha256:fixed', startedAt: 'fixed', limits: { NanoCpus: 0, Memory: 0 } };
    assertContainerUnchanged(before, structuredClone(before));
    expect(() => assertContainerUnchanged(before, { ...before, image: 'other' })).toThrow();
    expect(() => assertContainerUnchanged(before, { ...before, limits: { NanoCpus: 1, Memory: 0 } })).toThrow();
    assertSqlDurations({ queueMs: 10, computeAndStoreMs: 20, serverTotalMs: 30 });
    for (const row of [{ queueMs: -1, computeAndStoreMs: 20, serverTotalMs: 19 }, { queueMs: 10, computeAndStoreMs: null, serverTotalMs: 30 }, { queueMs: 10, computeAndStoreMs: 20, serverTotalMs: 31.1 }]) expect(() => assertSqlDurations(row)).toThrow();
  });
  it.each([429, 500, 503])('keeps HTTP %s even for HTML or invalid JSON', async status => {
    const observation = {};
    await expect(readObservedJson({ status, json: async () => { throw Error('HTML'); } }, observation)).rejects.toThrow();
    expect(observation).toEqual({ status });
  });
  it('keeps output outside the repository', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-load-paths-')), repo = path.join(root, 'repo');
    fs.mkdirSync(repo); assertExternalReportDirectory(repo, path.join(root, 'outside', 'new-run'));
    expect(() => assertExternalReportDirectory(repo, repo)).toThrow();
    expect(() => assertExternalReportDirectory(repo, path.join(repo, 'new-run'))).toThrow();
  });
  it('CLI help and missing GO do not invoke Docker, SQL or HTTP', () => {
    const runner = path.join(here, 'run.mjs');
    const env = { ...process.env, QUEUE_LOAD_GO: '', QUEUE_LOAD_WORKERS: '12', DATABASE_URL: '', QUEUE_LOAD_PROJECT: '' };
    const help = cp.spawnSync(process.execPath, [runner, '--help'], { env, encoding: 'utf8', timeout: 10000 });
    expect(help.status).toBe(0); expect(help.stdout).toContain('QUEUE_LOAD_WORKERS=12 or14');
    const denied = cp.spawnSync(process.execPath, [runner], { env, encoding: 'utf8', timeout: 10000 });
    expect(denied.status).toBe(1); expect(JSON.parse(denied.stderr)).toMatchObject({ preflightFailed: true });
    for (const change of [
      { QUEUE_LOAD_PROJECT: 'main-platform' },
      { QUEUE_LOAD_PROJECT: CONTOUR.project, QUEUE_LOAD_ORIGIN: 'http://127.0.0.1:3085' },
      { QUEUE_LOAD_PROJECT: CONTOUR.project, QUEUE_LOAD_ORIGIN: CONTOUR.origin, DATABASE_URL: 'postgresql://fixture:ephemeral@127.0.0.1:55436/alfa_queue_scaled' },
    ]) {
      const forbidden = cp.spawnSync(process.execPath, [runner], { env: { ...env, QUEUE_LOAD_GO: 'RUN', ...change }, encoding: 'utf8', timeout: 10000 });
      expect(forbidden.status).toBe(1); expect(JSON.parse(forbidden.stderr)).toMatchObject({ preflightFailed: true });
      expect(forbidden.stderr).not.toContain('ephemeral');
    }
  });
});
