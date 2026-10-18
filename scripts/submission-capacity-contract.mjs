import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const PROTOCOL = 'periodic-110-15-120-cohort-closed-1';
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const need = (condition, message) => assert.ok(condition, `Submission capacity: ${message}`);

/** Submission inputs are JSON values. Match the application's sorted canonical JSON. */
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') { need(Number.isFinite(value), 'nonfinite JSON value'); return JSON.stringify(value); }
  if (typeof value !== 'object') { const text = JSON.stringify(value); need(text !== undefined, 'non-JSON value'); return text; }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export const inputIdentity = (input, analyticalVersion) => canonicalJson({ version: analyticalVersion, input });
const sha256 = text => createHash('sha256').update(text).digest('hex');
export const renderedInputDigest = (input, analyticalVersion) => sha256(inputIdentity(input, analyticalVersion));

function diagnostics(value, input, enforceNominalThreshold = true) {
  need(value && finite(value.pendingWaitMaxS) && finite(value.blockedWaitMaxS) && Array.isArray(value.unfinished), 'missing nominal diagnostics');
  const threshold = input.thresholds?.p95WaitMaxMin * 60;
  need(finite(threshold) && (!enforceNominalThreshold || value.pendingWaitMaxS <= threshold && value.blockedWaitMaxS <= threshold), 'nominal waiting requires review');
  const ids = new Set();
  for (const task of value.unfinished) {
    need(Number.isSafeInteger(task.taskId) && !ids.has(task.taskId), 'invalid/duplicate unfinished task'); ids.add(task.taskId);
    need(['inbound', 'outbound', 'internal'].includes(task.kind) && ['transport', 'prefetch-pod', 'return-pod'].includes(task.operation), 'invalid unfinished operation');
    need([task.ageS, task.pendingWaitS, task.blockedWaitS].every(finite), 'unknown unfinished measurement');
    need(task.pendingWaitS <= task.ageS && task.blockedWaitS <= task.ageS && task.pendingWaitS <= value.pendingWaitMaxS && task.blockedWaitS <= value.blockedWaitMaxS, 'contradictory unfinished diagnostics');
  }
}

function executionIdentity(key, expected, version) {
  let execution;
  try { execution = JSON.parse(key); } catch { need(false, 'execution identity is not canonical JSON'); }
  need(execution?.version === version && inputIdentity(execution.input, version) === key, 'execution identity/version mismatch');
  for (const field of ['seed', 'layout', 'robots', 'demand', 'loadMassKg', 'thresholds', 'charge', 'pedestrians', 'transportWorkflow']) {
    need(canonicalJson({ value: execution.input[field] }) === canonicalJson({ value: expected[field] }), `execution changed ${field}`);
  }
  return execution.input;
}

/** Strict publication gate for the selected, server-replayed candidate; never changes raw status. */
export function assertQualifiedCapacity(results, versions, scenarioKey = 'purchase') {
  need(results?.modelVersion === versions.economics && results.simModelVersion === versions.analytical, 'stale financial/analytical version');
  const specs = results.scenarios?.filter(spec => spec.key === scenarioKey) ?? [];
  const finances = results.results?.filter(result => result.key === scenarioKey) ?? [];
  need(specs.length === 1 && finances.length === 1, 'selected scenario is missing/ambiguous');
  const spec = specs[0], financial = finances[0], evidence = spec.spatialEvidence;
  need(spec.kind === 'purchase' && financial.kind === 'purchase', 'selected candidate is not a purchase scenario');
  const source = results.runtime?.simInputs?.[scenarioKey]?.calculated;
  need(source && evidence?.input && source.transportWorkflow === 'closed-pod-1' && source.demand?.offered === undefined, 'missing original closed-pod input');
  const sourceKey = inputIdentity(source, versions.analytical);
  need(evidence.sourceInputKey === sourceKey && inputIdentity(evidence.input, versions.analytical) === sourceKey, 'nominal source identity mismatch');
  const nominalExecution = executionIdentity(evidence.executionInputKey, source, versions.analytical);
  need(evidence.simModelVersion === versions.spatial && evidence.assessment?.terminal === true && evidence.assessment.status === 'PARTIAL', 'nominal shortfall must remain explicit PARTIAL');
  const nominal = evidence.summary;
  need(nominal && [nominal.requiredPerH, nominal.achievedPerH, nominal.queueEnd, nominal.waitP95Min].every(finite), 'unknown nominal measurements');
  need(source.demand.peakPerH > 0 && nominal.requiredPerH === source.demand.peakPerH && nominal.achievedPerH < nominal.requiredPerH && nominal.fleet === source.robots.count, 'nominal result/source mismatch');
  need(nominal.queueEnd <= Math.max(3, source.demand.peakPerH * 0.05) && nominal.waitP95Min <= source.thresholds.p95WaitMaxMin, 'nominal queue/p95 failed');
  const review = evidence.capacityNominalReview;
  need(review?.eligible === true && Array.isArray(review.reasons) && review.reasons.length === 0, 'healthy frozen nominal review absent');
  diagnostics(review.diagnostics, source);
  const proof = evidence.capacityProof;
  need(proof?.schemaVersion === 'capacity-proof-1' && proof.protocolId === PROTOCOL && proof.simModelVersion === versions.spatial && proof.terminal === true && proof.status === 'PASS', 'terminal current capacity PASS absent');
  const derived = structuredClone(source);
  derived.demand = { ...derived.demand, warmupMin: 15, peakMin: 120, offered: { protocol: 'periodic-capacity-1', perH: source.demand.peakPerH * 1.10 } };
  const testKey = inputIdentity(derived, versions.analytical);
  need(proof.sourceInputKey === sourceKey && proof.testInputKey === testKey && inputIdentity(proof.input, versions.analytical) === testKey, 'capacity changed source/protocol input');
  const controlledExecution = executionIdentity(proof.executionInputKey, derived, versions.analytical);
  // Identical source N/layout must use identical prepared physical geometry/controllers.
  // Only the declared demand profile/horizon changes, already checked against derived.
  need(canonicalJson({ ...controlledExecution, demand: nominalExecution.demand }) === canonicalJson(nominalExecution), 'controlled execution changed physical preparation');
  const m = proof.metrics;
  need(m && ['requiredPerH', 'offeredPerH', 'arrivedPerH', 'deliveredCohortPerH', 'closedCohortPerH', 'oldestUnfinishedAgeS'].every(key => finite(m[key])), 'unknown capacity measurements');
  need(['deliveredCohort', 'closedCohort', 'unfinishedCustomerCount', 'unfinishedServiceCount'].every(key => count(m[key])), 'invalid capacity counters');
  need(m.requiredPerH === source.demand.peakPerH && m.offeredPerH === derived.demand.offered.perH && m.measurementStartS === 900 && m.measurementEndS === 8100, 'capacity rates/window changed');
  const expectedArrivals = Math.floor(8099 * m.offeredPerH / 3600) - Math.floor(899 * m.offeredPerH / 3600);
  need(m.arrivedPerH === expectedArrivals / 2 && m.closedCohort <= m.deliveredCohort && m.deliveredCohort <= expectedArrivals, 'capacity counts do not match periodic cohort');
  need(m.deliveredCohortPerH === m.deliveredCohort / 2 && m.closedCohortPerH === m.closedCohort / 2 && m.closedCohortPerH >= m.requiredPerH, 'fake PASS: completed cohort rates below target');
  diagnostics(proof.qualificationDiagnostics, source, false);
  const unfinished = proof.qualificationDiagnostics.unfinished;
  need(unfinished.filter(task => task.operation === 'transport').length === m.unfinishedCustomerCount && unfinished.filter(task => task.operation !== 'transport').length === m.unfinishedServiceCount, 'controlled unfinished counts mismatch');
  need(m.oldestUnfinishedAgeS === Math.max(0, ...unfinished.map(task => task.ageS)), 'controlled unfinished age mismatch');
  need(financial.status === 'ok' && Number.isFinite(financial.npvRub) && financial.npvRub > 0 && financial.items?.length === 1, 'positive selected financial candidate absent');
  need(spec.items?.length === 1 && typeof spec.items[0].productSlug === 'string' && spec.items[0].productSlug !== '' && spec.items[0].productSlug === financial.items[0].productSlug && spec.items[0].process === financial.items[0].process, 'selected financial product/process mismatch');
  need(financial.items[0].n === source.robots.count && financial.items[0].chargers === source.layout.chargers, 'finance uses another N/C');
  need(results.conclusion?.recommendedScenarioKey === null, 'nominal PARTIAL must not become full recommendation');
  return { spec, financial, evidence, proof, source };
}

/** Rendering uses the exact nominal observation, independently of the controlled proof. */
function assertVisualObservation(snapshot, evidence) {
  need(snapshot?.projectOrigin?.sourceInputKey === evidence.sourceInputKey, 'visual source identity mismatch');
  need(snapshot.projectOrigin.executionInputKey === evidence.executionInputKey, 'visual execution identity mismatch');
  need(snapshot.assessment?.status === evidence.assessment.status && snapshot.assessment.terminal === true, 'visual changed nominal status');
  need(snapshot.summary?.simModelVersion === evidence.simModelVersion, 'visual model mismatch');
  for (const key of ['fleet', 'requiredPerH', 'achievedPerH', 'queueEnd', 'waitP95Min']) need(snapshot.summary[key] === evidence.summary[key], `visual summary changed ${key}`);
  need(snapshot.input?.robots.count === evidence.input.robots.count && snapshot.input?.layout.chargers === evidence.input.layout.chargers, 'visual changed N/C');
}

export function assertVisualMatchesNominal(snapshot, evidence) {
  assertVisualObservation(snapshot, evidence);
  let execution;
  try { execution = JSON.parse(evidence.executionInputKey); } catch { need(false, 'nominal visual execution identity invalid'); }
  need(inputIdentity(snapshot.input, execution.version) === evidence.executionInputKey, 'rendered input differs from saved execution');
}

/** Recheck provenance at publication, not only while the browser captures the pictures. */
export function assertVisualSource(visual, source, assetSha256, versions) {
  need(visual && source?.project && source?.operation, 'visual provenance missing');
  need(visual.project === source.project.id && visual.projectRevision === source.project.revision, 'visual belongs to another project/revision');
  need(visual.engineRelease === source.operation.engineRelease, 'visual engine does not match saved operation');
  const { evidence } = assertQualifiedCapacity(source.results, versions);
  assertVisualObservation({
    input: { robots: { count: visual.fleet }, layout: { chargers: visual.chargers } },
    projectOrigin: visual.projectOrigin, assessment: visual.assessment, summary: visual.summary,
  }, evidence);
  need(visual.renderedInputSha256 === sha256(evidence.executionInputKey), 'rendered input digest does not match saved execution');
  need(inputIdentity(visual.projectOrigin.sourceInput, versions.analytical) === evidence.sourceInputKey, 'visual source input does not match its key');
  need(finite(visual.simulationTimeS) && visual.simulationTimeS <= (evidence.input.demand.warmupMin + evidence.input.demand.peakMin) * 60, 'invalid visual model time');
  need(Number.isSafeInteger(visual.robotId) && visual.robotId >= 0 && visual.robotId < evidence.summary.fleet, 'visual robot is outside selected fleet');
  for (const name of ['assets/warehouse-current.png', 'assets/robot-current.png']) {
    need(typeof assetSha256[name] === 'string' && /^[a-f0-9]{64}$/.test(assetSha256[name]), `missing asset hash ${name}`);
    need(visual.assetSha256?.[name] === assetSha256[name], `visual asset changed ${name}`);
  }
}

/** Match publication data before and after export/capture; a later SAVE invalidates the batch. */
export function assertPublishedSource(project, completed) {
  const job = completed?.job;
  need(job?.status === 'SUCCEEDED' && job.publicationState === 'PUBLISHED' && typeof job.projectId === 'string' && Number.isSafeInteger(job.publishedRevision), 'completed published operation missing');
  need(project?.id === job.projectId && project.revision === job.publishedRevision, 'project advanced beyond exported operation');
  need(completed.results && canonicalJson(project.results) === canonicalJson(completed.results), 'project results differ from completed operation');
}

/** Add an explicit request to real server-produced scenario inputs; never manufacture a PASS. */
export function requestCapacityScenarios(scenarios) {
  let requested = 0;
  const next = structuredClone(scenarios).map(spec => {
    if (!spec.spatialEvidence) return spec;
    const { capacityProof: _proof, capacityNominalReview: _review, ...nominal } = spec.spatialEvidence;
    void _proof; void _review; requested++;
    return { ...spec, spatialEvidence: { ...nominal, capacityRequested: true } };
  });
  need(requested > 0, 'no server-produced spatial input to request');
  return next;
}
