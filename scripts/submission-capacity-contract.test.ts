import { describe, expect, it } from 'vitest';
import { assertQualifiedCapacity, assertVisualMatchesNominal, assertVisualSource, assertPublishedSource, inputIdentity, renderedInputDigest, requestCapacityScenarios } from './submission-capacity-contract.mjs';

const versions = { economics: 'tz-current', analytical: 'sim-current', spatial: 'spatial-current' };
function fixture() {
  const source = { seed: 1, transportWorkflow: 'closed-pod-1', layout: { chargers: 2 }, robots: { count: 6 }, demand: { avgPerH: 8, peakPerH: 10, warmupMin: 15, peakMin: 120, mix: { inbound: .5, outbound: .5, internal: 0 } }, thresholds: { p95WaitMaxMin: 10 } };
  const input = { ...structuredClone(source), demand: { ...source.demand, offered: { protocol: 'periodic-capacity-1', perH: 11 } } };
  const diagnostics = { pendingWaitMaxS: 29, blockedWaitMaxS: 20, unfinished: [{ taskId: 10, operation: 'transport', kind: 'outbound', ageS: 200, pendingWaitS: 29, blockedWaitS: 0 }] };
  const evidence = { input: source, sourceInputKey: inputIdentity(source, versions.analytical), executionInputKey: inputIdentity(source, versions.analytical), simModelVersion: versions.spatial,
    assessment: { status: 'PARTIAL', terminal: true }, summary: { fleet: 6, requiredPerH: 10, achievedPerH: 9.5, queueEnd: 1, waitP95Min: 4 },
    capacityNominalReview: { eligible: true, reasons: [], diagnostics },
    capacityProof: { schemaVersion: 'capacity-proof-1', protocolId: 'periodic-110-15-120-cohort-closed-1', sourceInputKey: inputIdentity(source, versions.analytical), testInputKey: inputIdentity(input, versions.analytical), executionInputKey: inputIdentity(input, versions.analytical), input, simModelVersion: versions.spatial, status: 'PASS', terminal: true,
      metrics: { requiredPerH: 10, offeredPerH: 11, arrivedPerH: 11, deliveredCohort: 21, closedCohort: 20, deliveredCohortPerH: 10.5, closedCohortPerH: 10, measurementStartS: 900, measurementEndS: 8100, unfinishedCustomerCount: 0, unfinishedServiceCount: 0, oldestUnfinishedAgeS: 0 }, qualificationDiagnostics: { pendingWaitMaxS: 0, blockedWaitMaxS: 0, unfinished: [] } } };
  return { modelVersion: versions.economics, simModelVersion: versions.analytical, runtime: { simInputs: { purchase: { calculated: source } } }, scenarios: [{ key: 'purchase', kind: 'purchase', items: [{ process: 'transport', productSlug: 'selected-amr' }], spatialEvidence: evidence }], results: [{ key: 'purchase', kind: 'purchase', status: 'ok', npvRub: 4_000_000, items: [{ n: 6, chargers: 2, process: 'transport', productSlug: 'selected-amr' }] }], conclusion: { recommendedScenarioKey: null } };
}

describe('submission capacity publication contract', () => {
  it('accepts the separate current candidate without rewriting nominal PARTIAL', () => {
    const result = fixture(), before = structuredClone(result);
    expect(assertQualifiedCapacity(result, versions).proof.metrics.closedCohortPerH).toBe(10);
    expect(result).toEqual(before);
  });
  it.each(['fake-pass', 'unknown', 'stale-input', 'stale-version', 'wrong-count', 'unsafe-nominal', 'missing-diagnostics', 'full-recommendation', 'different-finance', 'raas-labelled-purchase', 'different-product', 'changed-execution', 'execution-site', 'execution-radius', 'execution-extra-field', 'unfinished-count', 'unfinished-age'])('rejects %s', kind => {
    const result = fixture(), evidence = result.scenarios[0]!.spatialEvidence, proof = evidence.capacityProof;
    if (kind === 'fake-pass') { proof.metrics.closedCohort = 19; proof.metrics.closedCohortPerH = 9.5; }
    if (kind === 'unknown') proof.status = 'NOT_EVALUATED';
    if (kind === 'stale-input') proof.input.seed++;
    if (kind === 'stale-version') proof.simModelVersion = 'old';
    if (kind === 'wrong-count') proof.metrics.deliveredCohortPerH++;
    if (kind === 'unsafe-nominal') evidence.capacityNominalReview.diagnostics.pendingWaitMaxS = 601;
    if (kind === 'missing-diagnostics') Reflect.deleteProperty(evidence.capacityNominalReview, 'diagnostics');
    if (kind === 'full-recommendation') Object.assign(result.conclusion, { recommendedScenarioKey: 'purchase' });
    if (kind === 'different-finance') result.results[0]!.items[0]!.n++;
    if (kind === 'raas-labelled-purchase') { result.scenarios[0]!.kind = 'raas'; result.results[0]!.kind = 'raas'; }
    if (kind === 'different-product') result.results[0]!.items[0]!.productSlug = 'another-amr';
    if (kind === 'changed-execution') proof.executionInputKey = inputIdentity({ ...proof.input, seed: 2 }, versions.analytical);
    if (kind === 'execution-site') proof.executionInputKey = inputIdentity({ ...proof.input, siteLayout: { widthM: 1000, heightM: 1000, slots: [] } }, versions.analytical);
    if (kind === 'execution-radius') proof.executionInputKey = inputIdentity({ ...proof.input, demoTraffic: { radiusM: .001, clearanceM: 0 } }, versions.analytical);
    if (kind === 'execution-extra-field') proof.executionInputKey = inputIdentity({ ...proof.input, demoUnderlift: { pods: [] } }, versions.analytical);
    if (kind === 'unfinished-count') proof.metrics.unfinishedCustomerCount++;
    if (kind === 'unfinished-age') proof.metrics.oldestUnfinishedAgeS++;
    expect(() => assertQualifiedCapacity(result, versions)).toThrow(/Submission capacity/);
  });
  it('requires the visual to show exactly the nominal PARTIAL input and summary', () => {
    const evidence = fixture().scenarios[0]!.spatialEvidence;
    const snapshot = { input: evidence.input, projectOrigin: { sourceInputKey: evidence.sourceInputKey, executionInputKey: evidence.executionInputKey }, assessment: evidence.assessment, summary: { ...evidence.summary, simModelVersion: versions.spatial } };
    expect(() => assertVisualMatchesNominal(snapshot, evidence)).not.toThrow();
    expect(() => assertVisualMatchesNominal({ ...snapshot, assessment: { status: 'OK', terminal: true } }, evidence)).toThrow();
    expect(() => assertVisualMatchesNominal({ ...snapshot, summary: { ...snapshot.summary, achievedPerH: 10 } }, evidence)).toThrow();
    expect(() => assertVisualMatchesNominal({ ...snapshot, input: { ...snapshot.input, siteLayout: { slots: [] } } }, evidence)).toThrow(/rendered input/);
    expect(() => assertVisualMatchesNominal({ ...snapshot, input: { ...snapshot.input, robots: { ...snapshot.input.robots, speedMps: 100 } } }, evidence)).toThrow(/rendered input/);
  });
  it('requests real recalculation while discarding a prior capacity claim', () => {
    const scenarios = fixture().scenarios, before = structuredClone(scenarios), next = requestCapacityScenarios(scenarios);
    expect(next[0]!.spatialEvidence.capacityRequested).toBe(true);
    expect(next[0]!.spatialEvidence).not.toHaveProperty('capacityProof');
    expect(next[0]!.spatialEvidence.assessment.status).toBe('PARTIAL');
    expect(scenarios).toEqual(before);
  });
  it.each(['current', 'old-project', 'old-revision', 'old-engine', 'wrong-source', 'wrong-execution', 'changed-status', 'changed-summary', 'wrong-rendered-digest', 'missing-hashes', 'warehouse-tamper', 'robot-tamper'])('rechecks visual provenance at publication: %s', kind => {
    const results = fixture(), evidence = results.scenarios[0]!.spatialEvidence;
    const source = { project: { id: 'selected-project', revision: 3 }, operation: { engineRelease: 'current-worker/protocol' }, results };
    const hashes = { 'assets/warehouse-current.png': 'a'.repeat(64), 'assets/robot-current.png': 'b'.repeat(64) };
    const visual = { project: source.project.id, projectRevision: 3, engineRelease: source.operation.engineRelease,
      simulationTimeS: 3000, fleet: 6, chargers: 2, robotId: 0, assessment: structuredClone(evidence.assessment),
      summary: { ...evidence.summary, simModelVersion: versions.spatial },
      projectOrigin: { sourceInputKey: evidence.sourceInputKey, executionInputKey: evidence.executionInputKey, sourceInput: structuredClone(evidence.input) },
      renderedInputSha256: renderedInputDigest(evidence.input, versions.analytical), assetSha256: { ...hashes } };
    if (kind === 'old-project') visual.project = 'previous-project';
    if (kind === 'old-revision') visual.projectRevision--;
    if (kind === 'old-engine') visual.engineRelease = 'old-worker/protocol';
    if (kind === 'wrong-source') visual.projectOrigin.sourceInputKey = 'old-source';
    if (kind === 'wrong-execution') visual.projectOrigin.executionInputKey = 'old-execution';
    if (kind === 'changed-status') visual.assessment.status = 'OK';
    if (kind === 'changed-summary') visual.summary.achievedPerH++;
    if (kind === 'wrong-rendered-digest') visual.renderedInputSha256 = '0'.repeat(64);
    if (kind === 'missing-hashes') Reflect.deleteProperty(visual, 'assetSha256');
    if (kind === 'warehouse-tamper') hashes['assets/warehouse-current.png'] = 'c'.repeat(64);
    if (kind === 'robot-tamper') hashes['assets/robot-current.png'] = 'd'.repeat(64);
    const check = () => assertVisualSource(visual, source, hashes, versions);
    if (kind === 'current') expect(check).not.toThrow();
    else expect(check).toThrow(/Submission capacity/);
  });
  it.each(['current', 'advanced-revision', 'another-project', 'another-result', 'not-published', 'unfinished-job', 'unknown-revision'])('binds exports to the completed publication: %s', kind => {
    const results = fixture();
    const completed = { job: { projectId: 'p', publishedRevision: 3, status: 'SUCCEEDED', publicationState: 'PUBLISHED' }, results };
    const project = { id: 'p', revision: 3, results: structuredClone(results) };
    if (kind === 'advanced-revision') project.revision++;
    if (kind === 'another-project') project.id = 'other';
    if (kind === 'another-result') project.results.results[0]!.npvRub++;
    if (kind === 'not-published') completed.job.publicationState = 'STALE';
    if (kind === 'unfinished-job') completed.job.status = 'RUNNING';
    if (kind === 'unknown-revision') Reflect.deleteProperty(completed.job, 'publishedRevision');
    const check = () => assertPublishedSource(project, completed);
    if (kind === 'current') expect(check).not.toThrow(); else expect(check).toThrow(/Submission capacity/);
  });
});
