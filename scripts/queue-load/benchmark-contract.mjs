import assert from 'node:assert/strict';

export const RESOURCE_FIELDS = ['NanoCpus', 'CpuPeriod', 'CpuQuota', 'CpuShares', 'CpusetCpus', 'CpusetMems', 'Memory', 'MemoryReservation', 'MemorySwap', 'PidsLimit'];
export function resourceLimits(container) {
  return Object.fromEntries(RESOURCE_FIELDS.map(key => {
    const value = container.HostConfig[key];
    assert.ok(typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' || value === null, 'Missing resource declaration field');
    return [key, value];
  }));
}
export function assertSqlDurations(job) {
  for (const key of ['queueMs', 'computeAndStoreMs', 'serverTotalMs']) assert.ok(Number.isFinite(job[key]) && job[key] >= 0, 'Unknown or negative SQL duration');
  assert.ok(Math.abs(job.serverTotalMs - job.queueMs - job.computeAndStoreMs) <= 1, 'SQL durations do not describe one execution interval');
}
export function assertContainerUnchanged(before, after) {
  assert.deepEqual(after, before, 'Container identity, image, start time, engine or resources changed during the benchmark');
}
/** Preserve known HTTP classification even if the body is HTML or invalid JSON. */
export async function readObservedJson(response, observation, statusField = 'status') {
  observation[statusField] = response.status;
  return response.json();
}
