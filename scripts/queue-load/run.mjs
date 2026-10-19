import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canonicalJson, assertQualifiedCapacity, requestCapacityScenarios } from '../submission-capacity-contract.mjs';
import { assertIsolatedDatabase } from './isolation.mjs';
import { resourceLimits, assertSqlDurations, assertContainerUnchanged, readObservedJson } from './benchmark-contract.mjs';
import { CONTOUR, parseDeclaredWorkers, sha, containerSuffixes, assertQueuePolicy, assertWorkerStartup, assertProfile, assertCanonicalCase, sourceGraph, declaredResources, filePins, businessSignature, assertFrozenRequest, assertExternalReportDirectory, assertAppPort, serviceNetwork, assertServiceNames, assertServiceTopology } from './declaration.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const require = createRequire(path.join(repo, 'package.json'));
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentiles = values => {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = p => ordered.length ? ordered[Math.ceil(p * ordered.length) - 1] : null;
  return { count: ordered.length, p50: at(.5), p95: at(.95), max: at(1) };
};
const safeError = error => ({ name: error?.name ?? 'Error', code: error?.code ?? null });
const moneySignature = results => results.results.map(row => ({ key: row.key, kind: row.kind, status: row.status,
  npvRub: row.npvRub, tcoRub: row.tcoRub, capexRub: row.capexRub, opexYearRub: row.opexYearRub, effectYearRub: row.effectYearRub,
  items: row.items?.map(item => ({ productSlug: item.productSlug, process: item.process, n: item.n, chargers: item.chargers })) }));
const dockerJson = args => JSON.parse(cp.execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 5e6 }));
let claimedOutput = null;

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Prepared controlled-capacity runner. Requires coordinator QUEUE_LOAD_GO=RUN, isolated project alfa-queue-scaled-20261019 / HTTP3087 / DB55440 alfa_queue_scaled, explicit QUEUE_LOAD_WORKERS=12 or14, matching database cap and worker pool2. Explicit immutable profile, CPU/RAM declarations, image and engine pins required. One reference, two smoke, one 50-client burst; no POST retries or Docker mutation. See scripts/queue-load/README.md.');
    return;
  }
  assert.equal(process.env.QUEUE_LOAD_GO, 'RUN', 'Coordinator GO required');
  const workers = parseDeclaredWorkers(process.env.QUEUE_LOAD_WORKERS);
  const project = process.env.QUEUE_LOAD_PROJECT;
  assert.equal(project, CONTOUR.project);
  const origin = new URL(process.env.QUEUE_LOAD_ORIGIN ?? '');
  assert.equal(origin.origin, CONTOUR.origin);
  assert.equal(origin.href, origin.origin + '/');
  assertIsolatedDatabase(process.env.DATABASE_URL);
  const expectedEngine = process.env.QUEUE_LOAD_EXPECT_ENGINE;
  assert.match(expectedEngine ?? '', /^alfa-robot\/sha256:[a-f0-9]{64}$/);
  const expectedJobEngine = process.env.QUEUE_LOAD_EXPECT_JOB_ENGINE;
  assert.ok(expectedJobEngine?.startsWith(expectedEngine + '/') && expectedJobEngine.length > expectedEngine.length + 1, 'Explicit full job engine identity required');
  const expectedImages = { app: process.env.QUEUE_LOAD_EXPECT_APP_IMAGE, worker: process.env.QUEUE_LOAD_EXPECT_WORKER_IMAGE };
  for (const value of Object.values(expectedImages)) assert.match(value ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.ok(process.env.QUEUE_LOAD_PROFILE && process.env.QUEUE_LOAD_REPORT_DIR);
  const profilePath = path.resolve(process.env.QUEUE_LOAD_PROFILE);
  const profileBytes = fs.readFileSync(profilePath);
  assert.equal(sha(profileBytes), process.env.QUEUE_LOAD_EXPECT_PROFILE_SHA256, 'Profile bytes differ from the declared pre-run SHA');
  const profile = JSON.parse(profileBytes);
  assertProfile(profile);
  assert.ok(process.env.QUEUE_LOAD_EXPECT_RESOURCES_FILE, 'Explicit resource declaration required');
  const resourcesPath = path.resolve(process.env.QUEUE_LOAD_EXPECT_RESOURCES_FILE);
  const resourceBytes = fs.readFileSync(resourcesPath);
  assert.equal(sha(resourceBytes), process.env.QUEUE_LOAD_EXPECT_RESOURCES_SHA256, 'Resource bytes differ from the declared pre-run SHA');
  const expectedResources = JSON.parse(resourceBytes);
  const localSourceGraph = sourceGraph(repo, expectedEngine);
  const pinsBefore = filePins(here, profilePath, resourcesPath);
  const dir = path.resolve(process.env.QUEUE_LOAD_REPORT_DIR);
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'Use a new empty report directory; never overwrite evidence');
  assertExternalReportDirectory(repo, dir);
  fs.mkdirSync(dir, { recursive: true });
  const base = origin.origin, run = 'stage3-load-' + Date.now();
  fs.writeFileSync(path.join(dir, 'run-owner.json'), JSON.stringify({ run, createdAt: new Date().toISOString() }), { flag: 'wx' });
  claimedOutput = dir;
  const hostResources = () => ({ cpuModel: os.cpus()[0]?.model, logicalCpu: os.cpus().length, ramBytes: os.totalmem() });
  const dockerResources = () => { const info = dockerJson(['info', '--format', '{{json .}}']); return { cpus: info.NCPU, memoryBytes: info.MemTotal }; };
  const hostBefore = hostResources(), dockerBefore = dockerResources();
  declaredResources(expectedResources, hostBefore, dockerBefore, workers);
  const out = { schema: 'stage3-load-result-1', run, startedAt: new Date().toISOString(), status: 'PREFLIGHT',
    scope: '53 distinct authenticated fixture owners: one unmeasured reference, two smoke, then one 50-client HTTP burst. Full N6/C2 nominal + controlled profile. No browser/GPU or industrial calibration claim.',
    configuration: { project, httpPort: CONTOUR.httpPort, dbPort: CONTOUR.dbPort, database: CONTOUR.database, workers: workers, globalLeaseCap: workers, workerPoolMax: CONTOUR.workerPoolMax, harnessDbPoolMax: 2, engine: expectedEngine, jobEngine: expectedJobEngine, images: expectedImages,
      versions: profile.versions, profileSha256: sha(profileBytes), profileCatalogueSha256: profile.catalogueSha256,
      runnerSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
      isolationGuardSha256: sha(fs.readFileSync(path.join(here, 'isolation.mjs'))),
      benchmarkContractSha256: sha(fs.readFileSync(path.join(here, 'benchmark-contract.mjs'))),
      declaredResourcesSha256: sha(resourceBytes),
      capacityContractSha256: sha(fs.readFileSync(path.join(repo, 'scripts/submission-capacity-contract.mjs'))),
      localSourceGraph, filePins: pinsBefore, host: hostBefore, docker: dockerBefore, sameHostClient: true },
    criteria: { burstClients: 50, firstPost202: 50, postTransportRetries: 0, unexpected5xx: 0, acceptedSucceeded: 50,
      acceptedResultsVerified: 50, attemptsPerJob: 1, maxValidLeases: workers, computeAndStoreEachMaxMs: 60000, clientResultEachMaxMs: 60000,
      drainCutoffMs: 600000, postTimeoutMs: 30000, pollIntervalMs: 1000, monitorIntervalMs: 250,
      ackP95MaxMs: 10000, ackMaxMs: 30000, healthP95MaxMs: 1000, healthMaxMs: 3000, pollP95MaxMs: 1000, pollMaxMs: 3000 },
    prior: 'Capacity is declared before the first request: explicit QUEUE_LOAD_WORKERS=12 or14, matching database cap, worker pool2. All previous end-to-end and compute60 criteria remain; no retries, scaling or retuning after measurement starts. A FAIL is retained.',
    containers: [], phases: [], health: [], leases: [], pollSamples: [], errors: [], fixtureCleanup: 'retained by default',
  };
  const save = () => fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(out, null, 2));
  // Inspect selected fields only: Config.Env can contain credentials and is never serialized.
  function inspectContainer(suffix) {
    const name = project + '-' + suffix;
    const row = dockerJson(['inspect', name])[0];
    assert.equal(row.State.Running, true);
    assert.equal(row.Config.Labels['com.docker.compose.project'], project);
    assert.equal(row.Config.Labels['com.docker.compose.service'], suffix.startsWith('app') ? 'app' : 'worker');
    assert.equal(row.Image, suffix.startsWith('app') ? expectedImages.app : expectedImages.worker);
    const embedded = dockerJson(['exec', name, 'cat', '/app/dist-worker/engine-release.json']);
    assert.equal(embedded.engineRelease, expectedEngine);
    assert.equal(sha(canonicalJson(embedded)), sha(canonicalJson(JSON.parse(fs.readFileSync(path.join(repo, 'dist-worker/engine-release.json'))))), 'Container and local source manifests differ');
    const label = (row.Config.Env.find(value => value.startsWith('CALCULATION_ENGINE_RELEASE=')) ?? '').slice('CALCULATION_ENGINE_RELEASE='.length).trim();
    assert.equal(label ? `${embedded.engineRelease}/${label}` : embedded.engineRelease, expectedJobEngine);
    const limits = resourceLimits(row);
    if (suffix.startsWith('app')) assertAppPort(row);
    assert.deepEqual(limits, expectedResources.containers[name], 'Actual resources differ from the explicit pre-run declaration');
    const internalDb = new URL((row.Config.Env.find(value => value.startsWith('DATABASE_URL=')) ?? '').slice('DATABASE_URL='.length));
    assert.ok(['postgres:', 'postgresql:'].includes(internalDb.protocol));
    assert.equal(internalDb.hostname, 'db'); assert.equal(internalDb.port, '5432'); assert.equal(internalDb.pathname, '/' + CONTOUR.database); assert.equal(internalDb.search + internalDb.hash, '');
    let workerStartup = null;
    if (suffix.startsWith('worker')) workerStartup = assertWorkerStartup(cp.execFileSync('docker', ['logs', '--since', row.State.StartedAt, name], { encoding: 'utf8', windowsHide: true, maxBuffer: 2e6, stdio: ['pipe', 'pipe', 'pipe'] }), expectedJobEngine, workers);
    return { name, id: row.Id, image: row.Image, engine: embedded.engineRelease, jobEngine: expectedJobEngine, startedAt: row.State.StartedAt, limits, workerStartup, network: serviceNetwork(row) };
  }
  function inspectDatabase() {
    const name = `${project}-db-1`, row = dockerJson(['inspect', name])[0], declaration = expectedResources.database;
    assert.ok(declaration && /^sha256:[a-f0-9]{64}$/.test(declaration.image), 'Explicit immutable database image/resources required');
    assert.equal(row.State.Running, true); assert.equal(row.Image, declaration.image); assert.equal(row.Config.Labels['com.docker.compose.project'], project); assert.equal(row.Config.Labels['com.docker.compose.service'], 'db');
    assert.ok(row.NetworkSettings.Ports['5432/tcp'].some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === String(CONTOUR.dbPort)), 'Expected isolated DB published port missing');
    assert.deepEqual(resourceLimits(row), declaration.limits);
    return { name, id: row.Id, image: row.Image, startedAt: row.State.StartedAt, limits: resourceLimits(row), network: serviceNetwork(row) };
  }
  function inspectWorkers() {
    const names = service => cp.execFileSync('docker', ['ps', '--filter', `label=com.docker.compose.project=${project}`, '--filter', `label=com.docker.compose.service=${service}`, '--format', '{{.Names}}'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(Boolean);
    assertServiceNames(names('app'), names('worker'), workers);
  }
  for (const suffix of containerSuffixes(workers)) out.containers.push(inspectContainer(suffix));
  inspectWorkers(); out.databaseContainer = inspectDatabase();
  out.networkBefore = assertServiceTopology(out.containers, out.databaseContainer, dockerJson(['network', 'inspect', out.databaseContainer.network.id])[0]);
  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, statement_timeout: 10000 });
  db.on('error', error => { out.errors.push({ phase: 'observer-pool', ...safeError(error) }); save(); });
  const ids = Array.from({ length: 53 }, () => crypto.randomUUID());
  const password = crypto.randomBytes(32).toString('hex');
  let monitoring = false, monitors = [], reference, fixedInput;
  const databaseIdentity = async () => (await db.query('SELECT current_database() AS database,pg_postmaster_start_time() AS "startedAt"')).rows[0];
  const queuePolicy = async () => assertQueuePolicy((await db.query('SELECT id,"maxActive" FROM "CalculationQueuePolicy" ORDER BY id')).rows, workers);
  const headersFor = index => ({ Origin: base, 'x-forwarded-for': `${run}-${index}` });
  async function authenticate(index) {
    const cookies = new Map(), email = `${run}-${index}@example.invalid`;
    const request = async (route, init = {}, timeout = 30000) => {
      const headers = new Headers({ ...headersFor(index), ...init.headers });
      headers.set('Cookie', [...cookies].map(([key, value]) => key + '=' + value).join('; '));
      const response = await fetch(base + route, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
      for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';', 1)[0], eq = pair.indexOf('='); if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1)); }
      return response;
    };
    const csrfResponse = await request('/api/auth/csrf'); assert.equal(csrfResponse.status, 200);
    const csrf = await csrfResponse.json(); assert.equal(typeof csrf.csrfToken, 'string');
    const login = await request('/api/auth/callback/credentials', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' }, body: new URLSearchParams({ email, password, csrfToken: csrf.csrfToken, callbackUrl: base + '/projects' }) });
    assert.equal(login.status, 200);
    const session = await (await request('/api/auth/session')).json(); assert.equal(session.user?.id, ids[index]);
    return { index, id: ids[index], request };
  }
  async function verifyResult(body, row) {
    assert.equal(body.job.status, 'SUCCEEDED'); assert.equal(body.job.publicationState, 'NONE');
    assert.equal(body.job.engineRelease, expectedJobEngine);
    assert.equal(body.job.attempts, 1); assert.equal(body.job.id, row.jobId);
    const verified = assertQualifiedCapacity(body.results, profile.versions);
    assertCanonicalCase(verified, profile);
    const persisted = await db.query('SELECT j.id,j.status,j.attempts,j."ownerId",j."runId",j."leaseToken",j."leaseUntil",r.input AS "frozenInput",r."inputHash",r."engineRelease",r."publicationState",r.results FROM "CalculationJob" j JOIN "CalculationRun" r ON r.id=j."runId" WHERE j.id=$1 AND j."ownerId"=$2', [row.jobId, row.ownerId]);
    assert.equal(persisted.rows.length, 1); const stored = persisted.rows[0];
    assert.equal(stored.status, 'SUCCEEDED'); assert.equal(stored.attempts, 1); assert.equal(stored.engineRelease, body.job.engineRelease);
    assert.equal(stored.publicationState, 'NONE'); assert.equal(stored.runId, body.job.runId);
    assert.equal(stored.leaseToken, null); assert.equal(stored.leaseUntil, null);
    assertFrozenRequest(stored.frozenInput, fixedInput, profile);
    assert.equal(canonicalJson(stored.results), canonicalJson(body.results));
    if (reference) {
      assert.deepEqual(moneySignature(body.results), reference.money);
      assert.equal(verified.evidence.sourceInputKey, reference.sourceKey);
      assert.equal(verified.proof.testInputKey, reference.testKey);
      assert.equal(stored.inputHash, reference.inputHash);
      assert.equal(businessSignature(body.results), reference.businessSignature, 'Current financial/norm/product inputs drifted between owners');
    }
    const filename = `${row.phase}-${row.index}-result.json`;
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(body));
    return { file: filename, sha256: sha(fs.readFileSync(path.join(dir, filename))), inputHash: stored.inputHash, businessSignature: businessSignature(body.results), frozenInputSha256: sha(canonicalJson(stored.frozenInput)),
      money: moneySignature(body.results), sourceKey: verified.evidence.sourceInputKey, testKey: verified.proof.testInputKey,
      nominal: verified.evidence.summary, capacity: verified.proof.metrics };
  }
  async function phase(name, clients, input) {
    const result = { name, startedAt: new Date().toISOString(), clients: clients.length, requestSha256: sha(canonicalJson(input)), requests: [] };
    out.phases.push(result); save();
    const barrier = performance.now(), deadline = barrier + out.criteria.drainCutoffMs;
    const clientsDone = await Promise.allSettled(clients.map(async client => {
      const row = { phase: name, index: client.index, ownerId: client.id, idempotencyKey: `${run}:${name}:${client.index}`, startSkewMs: performance.now() - barrier };
      result.requests.push(row); const start = performance.now();
      try {
        const response = await client.request('/api/v1/calculation-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': row.idempotencyKey }, body: JSON.stringify(input) });
        row.ackHeadersMs = performance.now() - start;
        const body = await readObservedJson(response, row, 'firstPostStatus'); row.ackMs = performance.now() - start;
        if (response.status === 202) { row.jobId = body.job.id; row.runId = body.job.runId; }
        else row.admissionRejected = true;
      } catch (error) {
        row.ackMs = performance.now() - start;
        if (row.firstPostStatus === undefined) row.postTransportError = safeError(error);
        else row.postResponseDecodeError = safeError(error);
      }
      // A timed-out transport is not silently retried or counted as accepted.
      if (!row.jobId) {
        const known = await db.query('SELECT id,"runId" FROM "CalculationJob" WHERE "ownerId"=$1 AND "idempotencyKey"=$2', [client.id, row.idempotencyKey]);
        if (known.rows.length) { row.jobId = known.rows[0].id; row.runId = known.rows[0].runId; row.acceptedOnlyBySqlReconciliation = true; }
      }
      while (row.jobId && performance.now() < deadline) {
        try {
          const pollStart = performance.now(), response = await client.request('/api/v1/calculation-jobs/' + row.jobId);
          const sample = { phase: name, status: response.status, ms: performance.now() - pollStart };
          out.pollSamples.push(sample);
          let body;
          try { body = await readObservedJson(response, sample); }
          finally { sample.ms = performance.now() - pollStart; }
          if (response.status !== 200) { row.pollErrors = (row.pollErrors ?? 0) + 1; }
          else if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(body.job.status)) {
            row.terminalObservedMs = performance.now() - start; row.terminalStatus = body.job.status;
            if (body.job.status === 'SUCCEEDED') {
              const receipt = await client.request('/api/v1/calculation-jobs/' + row.jobId + '/result');
              const completed = await readObservedJson(receipt, row, 'resultHttpStatus'); row.clientResultMs = performance.now() - start;
              // Preserve real receipt even if a later identity/financial/DB assertion fails.
              row.receiptFile = `${name}-${client.index}-result.json`;
              fs.writeFileSync(path.join(dir, row.receiptFile), JSON.stringify(completed));
              row.receiptSha256 = sha(fs.readFileSync(path.join(dir, row.receiptFile)));
              assert.equal(receipt.status, 200);
              row.verification = await verifyResult(completed, row); row.verified = true;
            }
            break;
          }
        } catch (error) {
          if (row.terminalStatus === 'SUCCEEDED') { row.verificationError = safeError(error); break; }
          row.pollErrors = (row.pollErrors ?? 0) + 1;
        }
        await sleep(1000);
      }
      if (row.jobId && !row.terminalStatus) row.drainTimedOut = true;
      save();
    }));
    for (const [index, outcome] of clientsDone.entries()) if (outcome.status === 'rejected') {
      const row = result.requests.find(request => request.index === clients[index].index);
      if (row) row.harnessError = safeError(outcome.reason);
      out.errors.push({ phase: name, index: clients[index].index, ...safeError(outcome.reason) });
    }
    const owners = clients.map(client => client.id);
    const jobs = await db.query(`SELECT j.id,j."ownerId",j."runId",j.status,j.attempts,j."idempotencyKey",r."inputHash",r."engineRelease",r."publicationState",
      EXTRACT(EPOCH FROM (j."startedAt"-j."createdAt"))*1000 AS "queueMs",
      EXTRACT(EPOCH FROM (j."finishedAt"-j."startedAt"))*1000 AS "computeAndStoreMs",
      EXTRACT(EPOCH FROM (j."finishedAt"-j."createdAt"))*1000 AS "serverTotalMs"
      FROM "CalculationJob" j JOIN "CalculationRun" r ON r.id=j."runId" WHERE j."ownerId"=ANY($1::text[])`, [owners]);
    result.jobs = jobs.rows.map(job => ({ ...job, queueMs: job.queueMs === null ? null : Number(job.queueMs), computeAndStoreMs: job.computeAndStoreMs === null ? null : Number(job.computeAndStoreMs), serverTotalMs: job.serverTotalMs === null ? null : Number(job.serverTotalMs) }));
    result.sqlDurationsValid = result.jobs.every(job => { try { assertSqlDurations(job); return true; } catch { return false; } });
    const rows = result.requests, n = clients.length;
    const accepted = rows.filter(row => row.firstPostStatus === 202);
    result.summary = { accepted202: accepted.length, firstPostStatuses: rows.reduce((counts, row) => { const key = row.firstPostStatus ?? 'transport-unknown'; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}), overload429: rows.filter(row => row.firstPostStatus === 429).length,
      unexpected5xx: rows.filter(row => row.firstPostStatus >= 500).length, transportErrors: rows.filter(row => row.postTransportError).length,
      postResponseDecodeErrors: rows.filter(row => row.postResponseDecodeError).length,
      verified: rows.filter(row => row.verified).length, unfinished: rows.filter(row => row.drainTimedOut).length,
      ackMs: percentiles(rows.map(row => row.ackMs)), queueMs: percentiles(result.jobs.map(job => job.queueMs)),
      computeAndStoreMs: percentiles(result.jobs.map(job => job.computeAndStoreMs)), clientResultMs: percentiles(rows.map(row => row.clientResultMs)),
      computeOver60Count: result.jobs.filter(job => job.computeAndStoreMs > 60000).length,
      clientResultOver60Count: rows.filter(row => row.clientResultMs > 60000 || row.clientResultMs === undefined).length };
    result.functionalPass = accepted.length === n && rows.every(row => row.verified && !row.postTransportError && !row.postResponseDecodeError && !row.pollErrors && !row.harnessError) &&
      result.jobs.length === n && new Set(result.jobs.map(job => job.runId)).size === n && result.jobs.every(job => job.status === 'SUCCEEDED' && job.attempts === 1);
    result.compute60Pass = result.functionalPass && result.sqlDurationsValid && result.jobs.every(job => job.computeAndStoreMs <= 60000);
    result.clientResult60Pass = result.functionalPass && rows.every(row => Number.isFinite(row.clientResultMs) && row.clientResultMs <= 60000);
    result.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ phase: name, functionalPass: result.functionalPass, compute60Pass: result.compute60Pass, clientResult60Pass: result.clientResult60Pass, summary: result.summary }));
    return result;
  }
  try {
    out.databaseBefore = await databaseIdentity(); assert.equal(out.databaseBefore.database, CONTOUR.database);
    out.queuePolicyBefore = await queuePolicy(); save();
    const health = await (await fetch(base + '/api/health', { signal: AbortSignal.timeout(10000) })).json();
    assert.equal(health.db, true); assert.equal(health.modelVersion, profile.versions.economics); assert.equal(health.simModelVersion, profile.versions.analytical);
    const active = await db.query('SELECT count(*)::int AS count FROM "CalculationJob" WHERE status IN (\'QUEUED\',\'RUNNING\')'); assert.equal(active.rows[0].count, 0);
    const initial = await fetch(base + '/api/v1/demo-calculation', { method: 'POST', headers: { ...headersFor('bootstrap'), 'Content-Type': 'application/json' }, body: JSON.stringify(profile.initial), signal: AbortSignal.timeout(75000) });
    assert.equal(initial.status, 200); const nominal = await initial.json();
    const input = { operation: 'CALCULATE', ...profile.initial, scenarios: requestCapacityScenarios(nominal.results.scenarios) };
    fixedInput = input;
    const declaredSource = nominal.results.scenarios.find(spec => spec.kind === 'purchase')?.spatialEvidence;
    assert.ok(declaredSource, 'Public nominal response lacks the declared actual source');
    assert.equal(sha(declaredSource.sourceInputKey), profile.declaredCase.sourceInputKeySha256, 'The canonical input changed before the reference');
    out.bootstrap = { sourceInputKeySha256: sha(declaredSource.sourceInputKey), nominalStatus: declaredSource.assessment.status, summary: declaredSource.summary };
    fs.writeFileSync(path.join(dir, 'fixed-request.json'), JSON.stringify(input, null, 2));
    out.configuration.requestSha256 = sha(canonicalJson(input));
    out.configuration.requestFileSha256 = sha(fs.readFileSync(path.join(dir, 'fixed-request.json')));
    out.configuration.sourceCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    out.configuration.sourceDiffSha256 = sha(cp.execFileSync('git', ['diff', 'HEAD'], { cwd: repo, maxBuffer: 30e6 }));
    const hash = await bcrypt.hash(password, 10);
    for (let index = 0; index < ids.length; index++) await db.query('INSERT INTO "User" (id,email,"passwordHash",name,"createdAt",role) VALUES ($1,$2,$3,$4,now(),\'USER\')', [ids[index], `${run}-${index}@example.invalid`, hash, run]);
    const clients = [];
    for (let index = 0; index < ids.length; index += 5) clients.push(...await Promise.all(ids.slice(index, index + 5).map((_, offset) => authenticate(index + offset))));
    out.setupFinishedAt = new Date().toISOString(); out.status = 'RUNNING'; save();
    const first = await phase('reference', clients.slice(0, 1), input);
    assert.ok(first.functionalPass && first.compute60Pass, 'Reference must pass before measured phases');
    reference = first.requests[0].verification;
    const smoke = await phase('smoke', clients.slice(1, 3), input);
    assert.ok(smoke.functionalPass && smoke.compute60Pass, 'Smoke must pass before 50-client burst');
    monitoring = true;
    monitors = [
      (async () => { while (monitoring) { const start = performance.now(), sample = { at: new Date().toISOString() }; out.health.push(sample); try { const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(10000) }); const body = await readObservedJson(response, sample); sample.db = body.db; } catch (error) { sample.error = safeError(error); } sample.ms = performance.now() - start; await sleep(Math.max(0, 1000 - (performance.now() - start))); } })(),
      (async () => { while (monitoring) { const start = performance.now(); try { const row = await db.query('SELECT EXTRACT(EPOCH FROM clock_timestamp()) AS "serverEpoch",(SELECT jsonb_agg(p ORDER BY p.id) FROM (SELECT id,"maxActive" FROM "CalculationQueuePolicy") p) AS policy,count(*) FILTER (WHERE status=\'RUNNING\' AND "leaseUntil">clock_timestamp())::int AS "validLeases",count(*) FILTER(WHERE status=\'QUEUED\')::int AS queued,count(*) FILTER(WHERE status=\'RUNNING\')::int AS running FROM "CalculationJob"'); out.leases.push(row.rows[0]); assertQueuePolicy(row.rows[0].policy, workers); } catch (error) { out.errors.push({ phase: 'lease-monitor', ...safeError(error) }); } await sleep(Math.max(0, 250 - (performance.now() - start))); } })(),
    ];
    const burst = await phase('burst', clients.slice(3), input);
    monitoring = false; await Promise.all(monitors);
    out.containersAfter = containerSuffixes(workers).map(inspectContainer); inspectWorkers();
    assertContainerUnchanged(out.containers, out.containersAfter);
    out.databaseContainerAfter = inspectDatabase(); assertContainerUnchanged(out.databaseContainer, out.databaseContainerAfter);
    out.networkAfter = assertServiceTopology(out.containersAfter, out.databaseContainerAfter, dockerJson(['network', 'inspect', out.databaseContainerAfter.network.id])[0]); assert.deepEqual(out.networkAfter, out.networkBefore);
    out.databaseAfter = await databaseIdentity(); assert.deepEqual(out.databaseAfter, out.databaseBefore);
    out.queuePolicyAfter = await queuePolicy(); assert.deepEqual(out.queuePolicyAfter, out.queuePolicyBefore);
    out.sourceGraphAfter = sourceGraph(repo, expectedEngine); assert.deepEqual(out.sourceGraphAfter, localSourceGraph);
    out.filePinsAfter = filePins(here, profilePath, resourcesPath); assert.deepEqual(out.filePinsAfter, pinsBefore);
    out.hostAfter = hostResources(); out.dockerAfter = dockerResources(); assert.deepEqual(out.hostAfter, hostBefore); assert.deepEqual(out.dockerAfter, dockerBefore);
    out.resourcesAndContainersUnchanged = true;
    const healthMs = percentiles(out.health.map(row => row.ms)), pollMs = percentiles(out.pollSamples.filter(row => row.phase === 'burst').map(row => row.ms));
    out.measurement = { healthMs, pollMs, healthSamples: out.health.length, leaseSamples: out.leases.length,
      maxValidLeases: Math.max(0, ...out.leases.map(row => row.validLeases)), healthErrors: out.health.filter(row => row.status !== 200 || row.db !== true).length };
    out.durabilityPass = burst.functionalPass && burst.sqlDurationsValid && out.resourcesAndContainersUnchanged && out.errors.length === 0 && out.measurement.healthErrors === 0 && out.measurement.maxValidLeases === workers && out.leases.every(row => row.validLeases <= workers) && out.leases.length > 0;
    out.compute60Pass = burst.compute60Pass; out.clientResult60Pass = burst.clientResult60Pass;
    out.responsivenessPass = out.health.length > 0 && healthMs.p95 <= 1000 && healthMs.max < 3000 && pollMs.count > 0 && pollMs.p95 <= 1000 && pollMs.max < 3000 && burst.summary.ackMs.p95 <= 10000 && burst.summary.ackMs.max < 30000;
    out.pass = out.durabilityPass && out.compute60Pass && out.clientResult60Pass && out.responsivenessPass;
    out.status = out.pass ? 'PASS' : 'FAIL'; out.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: out.status, durabilityPass: out.durabilityPass, compute60Pass: out.compute60Pass, clientResult60Pass: out.clientResult60Pass, responsivenessPass: out.responsivenessPass }));
    if (!out.pass) process.exitCode = 1;
  } catch (error) {
    out.status = 'FAIL'; out.failure = safeError(error); out.finishedAt = new Date().toISOString(); save();
    console.error(JSON.stringify({ status: 'FAIL', error: safeError(error) })); process.exitCode = 1;
  } finally {
    monitoring = false; await Promise.allSettled(monitors);
    // Deliberately retain exact synthetic fixtures and active jobs for independent diagnosis.
    out.fixtureCleanup = 'retained exact synthetic fixture users/jobs; no DELETE or cancellation performed'; save(); await db.end();
  }
}
main().catch(error => {
  const failure = { status: 'FAIL', preflightFailed: true, error: safeError(error) };
  console.error(JSON.stringify(failure)); process.exitCode = 1;
  if (claimedOutput) { try { fs.writeFileSync(path.join(claimedOutput, 'preflight-failure.json'), JSON.stringify(failure, null, 2)); } catch { /* Failure is already safely logged; an unwritable output cannot become PASS. */ } }
});
