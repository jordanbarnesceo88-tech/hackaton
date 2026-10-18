/* Canonical replay history. No renderer, predicted poses or future coverage enter these intervals. */
(function installRobotWorkHistory(root) {
  'use strict';

  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const now = () => performance.now();
  const checkAbort = signal => {
    if (signal?.aborted) {
      const error = new Error('Расчёт истории отменён');
      error.name = 'AbortError';
      throw error;
    }
  };

  // Read one robot directly: playbackFrame would also allocate every robot, task and coverage cell.
  function robotSample(state, input, robotId, cleaning, rack) {
    const indexed = state.robots[robotId];
    const robot = indexed?.id === robotId ? indexed : state.robots.find(r => r.id === robotId);
    if (!robot) throw new Error(`Робот ${robotId} отсутствует в модели`);
    let taskId = robot.task?.id ?? null;
    let zoneId = robot.zoneId ?? robot.task?.zoneId ?? null;
    const carrierId = rack ? robot.task?.podId ?? robot.underlift?.podId ?? null : null;
    const inventory = state.demoUnderlift;
    const carrierContents = carrierId && inventory ? inventory.pods[inventory.podIndex[carrierId]]?.contents ?? null : null;
    const internal = robot.task?.countsTowardDemand === false || robot.task?.id < 0;
    const operation = robot.task?.operation;
    const operationLabel = operation === 'return-pod' ? 'Возврат носителя' : operation === 'prefetch-pod' ? 'Подача носителя' : 'Перевозка';
    const parentTaskId = robot.task?.parentTaskId ?? null;
    let label = rack && robot.task ? `${internal ? 'Внутренний рейс' : 'Заявка'} #${robot.task.id} · ${operationLabel} · ${carrierId || '—'}${parentTaskId == null ? '' : ` · для #${parentTaskId}`}` : robot.task ? `${['inbound', 'putaway'].includes(robot.task.kind) ? 'Размещение' : ['outbound', 'retrieval'].includes(robot.task.kind) ? 'Отбор' : 'Задание'} #${robot.task.id}` : 'Без задания';
    if (cleaning && robot.zoneIndex != null) {
      const section = input.sections[robot.zoneIndex];
      const task = state.sections[robot.zoneIndex];
      zoneId = section?.id ?? null;
      taskId = task?.status === 'in_progress' ? robot.zoneIndex : null;
      label = taskId !== null ? section?.label ?? section?.name ?? 'Уборка секции' : ['toDock', 'waitingDock', 'charging', 'parking'].includes(robot.phase) ? 'Зарядная зона' : 'Без задания';
    }
    const phase = robot.incident?.active && robot.incident.haltsRobot ? 'incidentStop' : robot.safety?.blocked ? 'trafficWait' : robot.safety?.parking ? 'parking' : robot.phase;
    return { phase, taskId, zoneId, label, ...(rack ? { carrierId: carrierId ?? null, carrierContents, contentsAvailabilityUnverified: robot.task?.contentsAvailabilityUnverified ?? false, underliftStage: robot.underlift?.stage ?? null, operation: operation ?? null, countsTowardDemand: !internal, parentTaskId } : {}), loaded: robot.underlift ? robot.underlift.podLiftM > 1e-8 && robot.underlift.contact : Boolean(robot.loaded), incidentId: robot.incident?.id ?? null, reason: phase === 'incidentStop' ? robot.incident.label : robot.safety?.reason ?? null };
  }

  const keyOf = value => JSON.stringify([value.phase, value.taskId, value.zoneId, value.loaded, value.underliftStage, value.carrierId, value.carrierContents]);

  /**
   * robotId null/omitted: one replay for every robot. A numeric id returns one row.
   * Intervals describe observed canonical states on [startS,endS). No fabricated tail is added.
   * onProgress receives 0..100; an optional AbortSignal cancels between bounded slices.
   */
  async function createRobotWorkHistory({ Core, input, caseId, robotId = null, kind, onProgress, signal }) {
    if (!Core || !['createPlayback', 'stepPlayback', 'isPlaybackDone'].every(key => typeof Core[key] === 'function')) throw new Error('Не задан движок истории');
    if (robotId !== null && (!Number.isInteger(robotId) || robotId < 0)) throw new Error('Неверный номер робота');
    checkAbort(signal);
    onProgress?.(0);
    await pause();
    checkAbort(signal);
    const state = Core.createPlayback(input);
    if (!Array.isArray(state.robots) || !Number.isFinite(state.tS) || state.tS !== 0) throw new Error(`Неверное начальное состояние: ${caseId ?? ''}`);
    const ids = robotId === null ? state.robots.map(r => r.id) : [robotId];
    const cleaning = input.kind === 'cleaning' || kind === 'cleaning';
    const rack = !cleaning && Core.carrierSpec?.(input)?.kind === 'mobile-rack';
    const stepS = cleaning ? 0.1 : 1;
    const rows = ids.map(id => {
      const initial = robotSample(state, input, id, cleaning, rack);
      return { robotId: id, intervals: [{ startS: 0, endS: 0, ...initial }], key: keyOf(initial) };
    });
    let checkpoint = now(), steps = 0;
    while (!Core.isPlaybackDone(state)) {
      checkAbort(signal);
      const previousTime = state.tS;
      Core.stepPlayback(state, stepS);
      if (!Number.isFinite(state.tS) || state.tS <= previousTime) throw new Error('Движок истории не продвигает модельное время');
      const final = Core.isPlaybackDone(state);
      for (const row of rows) {
        const sample = robotSample(state, input, row.robotId, cleaning, rack);
        const key = keyOf(sample), last = row.intervals[row.intervals.length - 1];
        last.endS = state.tS;
        // The state first seen at the terminal instant has zero duration: do not invent a span.
        if (key !== row.key && !final) {
          row.intervals.push({ startS: state.tS, endS: state.tS, ...sample });
          row.key = key;
        }
      }
      if (++steps % 64 === 0 && now() - checkpoint >= 12) {
        onProgress?.(Math.min(99, state.endS > 0 ? state.tS / state.endS * 100 : 0));
        await pause();
        checkAbort(signal);
        checkpoint = now();
      }
    }
    onProgress?.(100);
    const robots = rows.map(({ robotId: id, intervals }) => ({ robotId: id, intervals }));
    return robotId === null ? { robots, endS: state.tS } : { ...robots[0], endS: state.tS };
  }

  root.createRobotWorkHistory = createRobotWorkHistory;
})(globalThis);
