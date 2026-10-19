import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalJson } from '../submission-capacity-contract.mjs';

export const CONTOUR = Object.freeze({ project: 'alfa-queue-scaled-20261019', origin: 'http://127.0.0.1:3087', httpPort: 3087, dbPort: 55440, database: 'alfa_queue_scaled', workerPoolMax: 2 });
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
/** The coordinator declares one allowed worker/cap tuple before any external action. */
export function parseDeclaredWorkers(value) {
  assert.ok(value === '12' || value === '14', 'QUEUE_LOAD_WORKERS must be exactly 12 or 14');
  return Number(value);
}
const requireWorkers = workers => { assert.ok(workers === 12 || workers === 14, 'Explicit allowed worker count required'); return workers; };
export const workerNames = workers => Array.from({ length: requireWorkers(workers) }, (_, i) => `${CONTOUR.project}-worker-${i + 1}`);
export const containerSuffixes = workers => ['app-1', ...Array.from({ length: requireWorkers(workers) }, (_, i) => `worker-${i + 1}`)];

export function assertQueuePolicy(rows, workers) {
  requireWorkers(workers);
  assert.deepEqual(rows, [{ id: 1, maxActive: workers }], 'The real database singleton policy must match the declared worker count');
  return { id: rows[0].id, maxActive: rows[0].maxActive };
}

export function assertWorkerStartup(logs, expectedJobEngine, workers) {
  requireWorkers(workers);
  const starts = logs.split(/\r?\n/).filter(line => line.startsWith('calculation_worker_started '));
  assert.equal(starts.length, 1, 'Exactly one startup record from the current container start is required');
  const pairs = starts[0].split(/\s+/).slice(1).map(token => token.split('='));
  assert.ok(pairs.every(pair => pair.length === 2), 'Malformed worker startup fields');
  assert.equal(new Set(pairs.map(pair => pair[0])).size, pairs.length, 'Duplicate worker startup fields');
  const fields = Object.fromEntries(pairs);
  assert.equal(fields.engine, expectedJobEngine, 'Worker startup engine mismatch');
  assert.equal(fields.concurrency, '1', 'One CPU job per worker is required');
  assert.equal(fields.globalCap, String(workers), 'Worker startup cap differs from the declared database policy');
  assert.equal(fields.dbPoolMax, String(CONTOUR.workerPoolMax), 'Worker database pool must be 2');
  assert.equal(fields.policy, 'database', 'Worker must use the database policy');
  return { engine: fields.engine, concurrency: 1, globalCap: workers, dbPoolMax: 2, policy: fields.policy };
}

export function assertProfile(profile) {
  assert.equal(profile.schema, 'stage3-load-profile-1');
  assert.ok(profile.versions && ['economics', 'analytical', 'spatial'].every(key => typeof profile.versions[key] === 'string' && profile.versions[key].length > 0), 'Explicit model versions required');
  assert.equal(profile.initial?.facility, 'warehouse');
  assert.ok(profile.initial.params && Array.isArray(profile.initial.scenarios), 'Canonical initial request required');
  assert.deepEqual(profile.initial.scenarios.map(spec => [spec.key, spec.kind]).sort(), [['asis', 'asis'], ['purchase', 'purchase'], ['raas', 'raas']], 'The fixed case requires exactly as-is, purchase and RaaS scenarios');
  for (const spec of profile.initial.scenarios.filter(spec => spec.kind !== 'asis')) {
    assert.equal(spec.items.length, 1);
    assert.deepEqual([spec.items[0].productSlug, spec.items[0].process, spec.items[0].quantityOverride, spec.items[0].chargersOverride], ['ronavi-h1500', 'pallet-transport', 6, 2], 'The profile must explicitly retain the N6/C2 product and process');
  }
  assert.match(profile.catalogueSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(profile.declaredCase?.sourceInputKeySha256 ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual([profile.declaredCase.fleet, profile.declaredCase.chargers, profile.declaredCase.seed], [6, 2, 1]);
  assert.ok(Math.abs(profile.declaredCase.requiredPerH - 51.81818181818182) < 1e-10, 'The original business goal must not change');
}

export function assertCanonicalCase(verified, profile) {
  assert.equal(verified.source.seed, 1); assert.equal(verified.source.robots.count, 6); assert.equal(verified.source.layout.chargers, 2);
  assert.ok(Math.abs(verified.source.demand.peakPerH - 51.81818181818182) < 1e-10);
  assert.equal(sha(verified.evidence.sourceInputKey), profile.declaredCase.sourceInputKeySha256, 'Actual canonical source differs from the declared profile');
  assert.equal(verified.evidence.assessment.status, 'PARTIAL');
  assert.equal(verified.evidence.summary.achievedPerH, 51.5);
  assert.equal(verified.proof.metrics.deliveredCohortPerH, 55); assert.equal(verified.proof.metrics.closedCohortPerH, 54.5);
  assert.ok(verified.financial.npvRub > 0, 'Positive purchase finance must remain separate from controlled physics');
}

export function sourceGraph(repo, expectedEngine) {
  const filename = path.join(repo, 'dist-worker/engine-release.json'), bytes = fs.readFileSync(filename), manifest = JSON.parse(bytes);
  assert.equal(manifest.engineRelease, expectedEngine, 'Local worker source graph differs from the declared image engine');
  assert.ok(Array.isArray(manifest.sources) && manifest.sources.length > 0);
  const hash = crypto.createHash('sha256'), files = {};
  for (const relative of manifest.sources) {
    assert.ok(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'Invalid worker graph path');
    const contents = fs.readFileSync(path.join(repo, relative));
    hash.update(relative).update('\0').update(contents).update('\0'); files[relative] = sha(contents);
  }
  hash.update('compiled-probe\0').update(manifest.compiledProbeSha256);
  assert.equal('alfa-robot/sha256:' + hash.digest('hex'), expectedEngine, 'Executable sources changed after the image build');
  return { engine: expectedEngine, manifestSha256: sha(bytes), sourceCount: manifest.sources.length, files };
}

export function declaredResources(declaration, actualHost, actualDocker, workers) {
  requireWorkers(workers);
  assert.equal(declaration.schema, 'stage3-load-resources-1');
  assert.deepEqual(declaration.host, actualHost, 'Host CPU/RAM declaration differs before the first request');
  assert.deepEqual(declaration.docker, actualDocker, 'Docker CPU/RAM declaration differs before the first request');
  assert.deepEqual(Object.keys(declaration.containers).sort(), containerSuffixes(workers).map(suffix => `${CONTOUR.project}-${suffix}`).sort(), 'Declare all and only the app plus the declared worker resource limits');
}

export function filePins(here, profilePath, resourcesPath) {
  return Object.fromEntries(['run.mjs', 'isolation.mjs', 'benchmark-contract.mjs', 'declaration.mjs'].map(name => [name, sha(fs.readFileSync(path.join(here, name)))]).concat([
    ['profile', sha(fs.readFileSync(profilePath))], ['resources', sha(fs.readFileSync(resourcesPath))],
    ['capacity-contract', sha(fs.readFileSync(path.resolve(here, '../submission-capacity-contract.mjs')))],
  ]));
}

export function businessSignature(results) {
  return sha(canonicalJson({ inputs: results.runtime.simInputs, norms: results.normsUsed, params: results.paramsUsed,
    products: results.productSnapshots, scenarios: results.scenarios.map(({ spatialEvidence: _evidence, ...spec }) => { void _evidence; return spec; }) }));
}

export function catalogueSignature(live) {
  return sha(canonicalJson({ products: live.products, norms: live.norms, paramDefs: live.paramDefs }));
}

export function assertFrozenRequest(frozen, request, profile) {
  assert.equal(frozen.schemaVersion, 1); assert.equal(frozen.operation, 'CALCULATE');
  assert.equal(frozen.input.facility, request.facility);
  assert.deepEqual(frozen.input.params, request.params, 'Stored request parameters were stripped or changed');
  assert.deepEqual(frozen.input.scenarios, request.scenarios, 'Stored scenario input was stripped or changed');
  assert.equal(catalogueSignature(frozen.live), profile.catalogueSha256, 'Frozen actual catalogue/norms/definitions differ from the declared profile');
}

export function assertExternalReportDirectory(repo, directory) {
  let ancestor = directory;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, directory));
  const relative = path.relative(fs.realpathSync(repo), resolved);
  assert.ok(relative && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)), 'Reports must be outside the repository, including symlink targets');
}

export function assertAppPort(container) {
  assert.deepEqual(container.NetworkSettings.Ports['3000/tcp'], [{ HostIp: '127.0.0.1', HostPort: String(CONTOUR.httpPort) }], 'The inspected single app must own the exact loopback HTTP origin');
}

export function serviceNetwork(container) {
  const entries = Object.entries(container.NetworkSettings.Networks);
  assert.equal(entries.length, 1, 'A tested service must have only the isolated project network');
  const [name, network] = entries[0];
  assert.equal(name, CONTOUR.project + '_default');
  assert.match(network.NetworkID, /^[a-f0-9]{64}$/);
  assert.ok(network.IPAddress, 'Running service network address missing');
  return { name, id: network.NetworkID, address: network.IPAddress, aliases: [...(network.Aliases ?? [])].sort() };
}

export function assertServiceNames(apps, workers, declaredWorkers) {
  requireWorkers(declaredWorkers);
  assert.deepEqual([...apps].sort(), [CONTOUR.project + '-app-1'], 'Exactly the pinned single app must serve this contour');
  assert.deepEqual([...workers].sort(), workerNames(declaredWorkers).sort(), 'Exactly the declared pinned workers required');
}

export function assertServiceTopology(containers, database, actualNetwork) {
  assert.equal(actualNetwork.Name, CONTOUR.project + '_default');
  assert.equal(actualNetwork.Id, database.network.id);
  assert.ok(database.network.aliases.includes('db'), 'The inspected database must own the db alias');
  for (const container of containers) {
    assert.equal(container.network.id, database.network.id, 'App/worker would resolve db on another network');
    assert.ok(!container.network.aliases.includes('db'), 'App/worker must not shadow the database alias');
  }
  const expected = [...containers, database].map(row => [row.id, row.name]).sort((a,b) => a[0].localeCompare(b[0]));
  const members = Object.entries(actualNetwork.Containers).map(([id, value]) => [id, value.Name]).sort((a,b) => a[0].localeCompare(b[0]));
  assert.deepEqual(members, expected, 'Only the inspected service identities may share the tested network');
  return { id: actualNetwork.Id, name: actualNetwork.Name, members };
}
