/* global WarehouseDemoCore, createWarehouseScene, createRobotInspection, createIncidentPanel, createAssessmentPanel, createFleetComparisonPanel */
(() => {
  'use strict';
  const Core = WarehouseDemoCore;
  const $ = id => document.getElementById(id);
  const config = JSON.parse($('demo-config').textContent);
  const projectHash = new URLSearchParams(location.hash.slice(1));
  const projectMode = config.initialCase !== 'sections' && projectHash.has('project');
  const projectRequestId = projectHash.get('project');
  const viewerUrl = kind => location.protocol === 'file:' ? `./${kind}-3d.html` : `/demo/${kind}`;
  $('complex-demo-link').href = `${viewerUrl('warehouse')}?case=complex`;
  $('cleaning-demo-link').href = viewerUrl('cleaning');
  $('demo-link').href = viewerUrl(config.initialCase === 'sections' ? 'warehouse' : 'cleaning');
  const numberFormats = new Map();
  const format = (value, digits = 1) => {
    if (!Number.isFinite(value)) return '—';
    if (!numberFormats.has(digits)) numberFormats.set(digits, new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }));
    return numberFormats.get(digits).format(value);
  };
  const money = value => Number.isFinite(value) ? `${format(value / 1e6, 2)} млн ₽` : '—';
  const clockText = seconds => {
    const s = Math.max(0, Math.floor(seconds));
    return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
  };
  const phaseLabels = { trafficWait: 'Уступает дорогу', transit: 'Переезд по проходу', working: 'Уборка прохода', toDock: 'Возврат на базу', waitingDock: 'Ожидание зарядного поста', parking: 'На парковку', done: 'Задания завершены', idle: 'Ожидание задания', toPickup: 'К месту погрузки', waitPoint: 'Очередь к точке', loading: 'Погрузка', toDrop: 'Перевозка груза', unloading: 'Выгрузка', toCharger: 'К зарядной станции', waitCharger: 'Очередь к зарядке', charging: 'Зарядка' };
  const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  let current = null, state = null, frame = null, playing = false, mode = 'final', speed = 1, carry = 0, last = 0;
  let projectSnapshot = null, financialEvaluation = null;
  let selectedId = null, currentLayer = 'all', dirty = false, busy = false, comparing = false, animation = 0, viewer = null;
  const requestedCase = new URLSearchParams(location.search).get('case');
  const validRequestedCase = Core.DEMO_CASES.some(item => item.id === requestedCase && (config.initialCase === 'sections' ? item.id === 'sections' : item.id !== 'sections'));
  let activeCase = !projectMode && validRequestedCase ? requestedCase : config.initialCase || Core.DEMO_CASES[0].id;
  let treeEntries = [];
  let following = false, tab = 'fleet', lastUi = 0, lastScene = 0;
  const fleetRows = new Map(), sectionRows = new Map();
  const taskRows = new Map(), eventRows = new Map();
  const isCleaning = () => current?.kind === 'cleaning';
  const carrier = () => Core.carrierSpec(current?.input);
  const isRack = () => !isCleaning() && carrier().kind === 'mobile-rack';
  const liftStages = { approach: 'Подъезд к носителю', 'dock-under': 'Заезд под стеллаж', 'close-gap': 'Подвод платформы до контакта', lift: 'Подъём стеллажа', extract: 'Извлечение стеллажа из ряда', retreat: 'Безопасный отход задним ходом', carry: 'Перевозка стеллажа', lower: 'Опускание на опоры', retract: 'Опускание платформы', exit: 'Выезд из-под стеллажа' };
  const phaseLabel = (phase, underlift) => (!['incidentStop', 'trafficWait', 'parking'].includes(phase) && liftStages[underlift?.stage]) || liftStages[phase] || phaseLabels[phase] || phase;
  const taskKind = task => task.operation === 'return-pod' ? 'Возврат носителя' : task.operation === 'prefetch-pod' ? 'Подача носителя' : task.kind === 'internal' ? 'Клиентское перемещение: хранение → хранение' : ['putaway','inbound'].includes(task.kind) ? 'Размещение' : ['retrieval','outbound'].includes(task.kind) ? 'Отбор' : task.kind;
  const taskScope = task => task.countsTowardDemand === false || task.id < 0 ? 'Внутренний рейс' : 'Заявка';
  const customerDone = robot => robot.customerTasksDone ?? robot.tasksDone ?? 0;
  const robotName = id => `${isCleaning() ? 'CL' : 'AMR'}-${String(id + 1).padStart(2, '0')}`;
  const sectionStatus = { queued: 'В очереди', pending: 'В очереди', active: 'В работе', working: 'В работе', done: 'Завершена', completed: 'Завершена' };
  sectionStatus.in_progress = 'В работе'; sectionStatus.incomplete = 'Частично выполнена';
  let seeking = false, rangeDragging = false;
  let calculationWorker = null, workerUrl = null, workerPending = null;
  function calculateOffscreen(id, overrides) {
    if (!calculationWorker && typeof Worker === 'function') {
      try {
        const code = $('demo-core-script').textContent + '\nself.onmessage=function(event){try{self.postMessage({result:event.data.id==="project"?WarehouseDemoCore.calculateProjectPreview(event.data.overrides):event.data.id==="financial-candidate"?WarehouseDemoCore.recheckSpatialFinanceInput(event.data.overrides):WarehouseDemoCore.calculateCase(event.data.id,event.data.overrides)});}catch(error){self.postMessage({error:error.message});}};';
        workerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        calculationWorker = new Worker(workerUrl);
        calculationWorker.onmessage = event => {
          if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
          const pending = workerPending; workerPending = null;
          if (event.data.error) pending?.reject(new Error(event.data.error)); else pending?.resolve(event.data.result);
        };
        calculationWorker.onerror = () => {
          workerPending?.reject(new Error('Не удалось выполнить расчёт в фоновом потоке. Обновите страницу и повторите.')); workerPending = null;
          calculationWorker.terminate(); calculationWorker = null;
          if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
        };
      } catch { if (workerUrl) URL.revokeObjectURL(workerUrl); workerUrl = null; calculationWorker = null; }
    }
    if (!calculationWorker) return Promise.resolve().then(() => id === 'project' ? Core.calculateProjectPreview(overrides) : id === 'financial-candidate' ? Core.recheckSpatialFinanceInput(overrides) : Core.calculateCase(id, overrides));
    return new Promise((resolve, reject) => { workerPending = { resolve, reject }; calculationWorker.postMessage({ id, overrides }); });
  }
  const inspection = createRobotInspection({ Core, onSeek: seconds => seekTo(seconds), onSelectRobot: id => { viewer?.selectObject?.(`robot:${id}`); inspection.openRobot(id); } });
  const incidents = createIncidentPanel({ onSeek: seconds => seekTo(seconds), onFocus: id => viewer?.focusIncident?.(id), onRobot: id => { viewer?.selectObject?.(`robot:${id}`); inspection.openRobot(id); }, onTab: () => selectTab('incidents') });
  const assessmentPanel = createAssessmentPanel({ onEvidence: async evidence => {
    await seekTo(evidence.tS);
    if (evidence.robotId != null) { viewer?.selectObject?.(`robot:${evidence.robotId}`); inspection.openRobot(evidence.robotId); }
    else if (evidence.zoneId != null) viewer?.focus?.(`section:${evidence.zoneId}`);
    else if (evidence.taskId != null) {
      selectTab('tasks');
      const row = [...$('task-rows').rows].find(r => Number(r.dataset.taskId) === evidence.taskId);
      if (row) { row.tabIndex = -1; row.focus(); row.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
      else $('tab-tasks').focus();
      return;
    }
    document.querySelector('.canvas-pane').scrollIntoView({ block: 'start', behavior: 'instant' });
  } });

  const comparisonPanel = createFleetComparisonPanel({
    onBusy(value) { comparing = value; setBusy(busy); },
    async onApply(candidate) {
      if (busy || dirty || comparing) throw new Error('Дождитесь завершения текущего действия и примените условия объекта.');
      playing = false; setBusy(true);
      try {
        await nextPaint();
        installModel(candidate, candidate.id, { modified: true, preserveComparison: true });
        document.querySelector('.canvas-pane').scrollIntoView({ block: 'start', behavior: 'instant' });
        $('play').focus({ preventScroll: true });
      } finally { setBusy(false); }
    },
  });

  function text(id, value) { $(id).textContent = value; }
  function rateMetric(id, value) {
    const unit = document.createElement('span'); unit.className = 'metric-unit'; unit.textContent = 'пал./ч';
    $(id).replaceChildren(document.createTextNode(`${formatRate(value)} `), unit);
  }
  function formatRate(value) {
    const s = current?.summary;
    let digits = 2;
    // A missed target must remain visibly different after rounding.
    while (digits < 8 && s?.achievedPerH + 1e-8 < s?.requiredPerH && format(s.achievedPerH, digits) === format(s.requiredPerH, digits)) digits++;
    return format(value, digits);
  }
  function facts(container, rows) {
    const nodes = rows.map(([label, value]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = String(value); row.append(dt, dd); return row;
    });
    $(container).replaceChildren(...nodes);
  }
  function carrierFacts(robot) {
    const spec = carrier(), lift = robot.underlift;
    const id = robot.carrierId || robot.task?.carrierId || lift?.podId;
    const pod = frame.carriers?.find(item => item.id === id);
    return [['Идентификатор носителя', id || 'Не назначен'], ['Рейс', robot.task ? `${taskScope(robot.task)} · ${taskKind(robot.task)}` : 'Нет задания'], ...(robot.task?.parentTaskId == null ? [] : [['Родительская заявка', `#${robot.task.parentTaskId}`]]), ['Содержимое носителя', (robot.carrierContents ?? pod?.contents) === 'empty' ? 'Пустой — груз разгружен' : id ? 'С грузом' : 'Носитель не назначен'], ['Габариты носителя', `${format(spec.lengthM,2)} × ${format(spec.widthM,2)} × ${format(spec.heightM,2)} м · ${spec.levels} ярусов`], ...(pod ? [['Домашнее место', `${format(pod.home.x)} / ${format(pod.home.y)} м`], ['Назначен роботу', pod.robotId == null ? 'Не назначен' : robotName(pod.robotId)]] : []), ...(lift ? [['Этап механики', liftStages[lift.stage] || lift.stage], ['Верх платформы от пола', `${format(lift.platformTopM,3)} м`], ['Опоры стеллажа над полом', `${format(lift.podLiftM,3)} м`], ['Зазор до платформы', `${format(lift.contactGapM,3)} м`], ['Контакт', lift.contact ? 'Есть' : 'Нет']] : []), ['Источник параметров', spec.sourceNote]];
  }
  function selection(item) {
    if (item?.kind === 'incident') { selectedId = item.id; following = false; $('follow').setAttribute('aria-pressed','false'); viewer?.setFollow?.(null); $('selection').hidden = true; incidents.open(item.details?.incidentId ?? item.id.slice(9)); renderFleet(); renderTree(); return; }
    if (!item) { selectedId = null; following = false; $('follow').setAttribute('aria-pressed', 'false'); viewer?.setFollow?.(null); $('selection').hidden = true; return; }
    const changed = selectedId !== item.id;
    selectedId = item.id;
    text('selection-title', item.name || item.id);
    text('selection-source', item.source === 'organizer' ? 'Параметры — данные организатора. Внешний вид условный.' : item.source && item.source !== 'assumption' ? item.source : 'Геометрия и внешний вид — допущение визуализации.');
    const values = item.details && typeof item.details === 'object' ? Object.entries(item.details) : [];
    facts('selection-details', values.map(([k, v]) => [k, typeof v === 'number' ? format(v, 2) : String(v)]));
    $('selection').hidden = false;
    $('robot-live').hidden = !item.id.startsWith('robot:');
    $('task-process').hidden = !item.id.startsWith('robot:');
    $('follow').hidden = !item.id.startsWith('robot:');
    $('robot-inspect').hidden = !item.id.startsWith('robot:');
    if (following && changed) viewer?.setFollow?.(item.id.startsWith('robot:') ? Number(item.id.slice(6)) : null);
    updateSelectedRobot(); updateSelectedSection(); renderFleet();
    renderTree();
  }
  try {
    viewer = createWarehouseScene({ container: $('stage'), onSelect: selection, onInspect: id => inspection.openRobot(Number(id.slice(6))) });
  } catch (error) {
    text('input-error', `3D недоступно в этом браузере: ${error.message}. Расчёт и выгрузка данных доступны.`);
    const fallback = document.createElement('p');
    fallback.textContent = 'Для 3D нужен браузер с WebGL. Результат проверки и исходные данные доступны в панелях.';
    fallback.style.cssText = 'position:absolute;inset:100px 24px auto;text-align:center;line-height:1.6';
    $('stage').append(fallback);
  }
  for (const item of Core.DEMO_CASES) {
    if (config.initialCase === 'sections' ? item.id !== 'sections' : item.id === 'sections') continue;
    const button = document.createElement('button');
    button.className = 'preset'; button.type = 'button'; button.dataset.case = item.id;
    const title = document.createElement('b'), detail = document.createElement('small');
    title.textContent = item.title; detail.textContent = item.description;
    button.append(title, detail); button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => calculate(item.id, undefined, true));
    $('presets').append(button);
  }
  function setBusy(value) {
    busy = value; $('loading').hidden = !value;
    document.querySelectorAll('.preset, #parameters input, #recalculate').forEach(el => { el.disabled = value || comparing || projectMode; });
    if (current && isCleaning()) $('peak').disabled = true;
    updateControls();
  }
  function updateControls() {
    $('play').disabled = busy || playing || !current;
    $('pause').disabled = busy || !playing;
    $('restart').disabled = busy || !current;
    $('finish').disabled = busy || !current || mode === 'final';
    $('export-json').disabled = busy || comparing || dirty || !current;
    $('export-png').disabled = busy || comparing || dirty || !current || !viewer;
    $('report-top').disabled = busy || comparing || dirty || !current;
    $('pilot-open').disabled = busy || comparing || dirty || !current;
    $('decision-compare').disabled = busy || comparing || dirty || !current;
    $('decision-action').disabled = busy || comparing || dirty || !current || isCleaning() || !['OK','PARTIAL'].includes(current.assessment?.status);
    for (const id of ['timeline','back-minute','forward-minute']) $(id).disabled = busy || !current;
    $('assessment-checks').inert = dirty || busy;
    comparisonPanel.setExternalBusy(busy);
  }
  function setDirty(value) {
    dirty = value; $('dirty').hidden = !value;
    comparisonPanel.setDirty(value);
    if (current && frame) renderFleetCount();
    if (current) renderResult();
    updateControls();
  }
  function renderFleetCount() {
    const fleetNote = $('fleet-model-count'); if (!fleetNote || !frame || !current) return;
    const sceneCount = viewer?.getStats?.().robotCount;
    fleetNote.textContent = `Задано в форме: ${$('fleet').value} · В расчёте: ${current.input.robots.count} · В модели: ${frame.robots.length} · На сцене: ${sceneCount ?? frame.robots.length} · Едут: ${frame.robots.filter(r => r.vMps > .001).length} · Стоят: ${frame.robots.filter(r => !(r.vMps > .001)).length}${dirty ? ' · Новые условия ещё не применены' : ''}`;
    const safety = frame.safety;
    $('safety-status').hidden = !safety;
    if (safety) $('safety-status').textContent = `Движение с резервированием пути${safety.maxActiveRoutes ? ` · Задания и путь к зарядке: ${safety.activeRoutes} / ${safety.maxActiveRoutes} · Возвращаются без задания: ${safety.returningHomeRoutes ?? 0} · На парковках: ${safety.parkedRobots}. Лимит — настройка диспетчера; возврат и стоянка на зарядке его не занимают, проверка безопасности действует для всех` : ''} · Уступают дорогу: ${safety.waitingRobots} · Объездов: ${safety.detours} · Радиус корпуса: ${format(safety.radiusM,2)} м · Зазор: ${format(safety.requiredClearanceM,2)} м. Защитные контуры — модель, не сертифицированная система безопасности.`;
    $('safety-zones').disabled = !safety;
  }
  function renderResult() {
    if (!current) return;
    if (isCleaning()) { renderCleaningResult(); return; }
    const s = current.summary;
    rateMetric('required', s.requiredPerH);
    rateMetric('achieved', s.achievedPerH);
    text('queue', `${format(s.queueMax, 0)} заданий`);
    renderAssessment();
    facts('facts', [['Парк / зарядки', `${current.input.robots.count} / ${current.input.layout.chargers}`], ['Фактически поступило', `${format(s.arrivedPerH)} пал./ч`], ['Начали в пиковом окне', `${format(s.servedShare * 100)} % заданий`], ['Ожидание до начала p95', `${format(s.waitP95Min)} мин`], ['Очередь в конце / допуск', `${format(s.queueEnd, 0)} / ${format(s.endQueueLimit)}`]]);
    const p = current.finance?.purchase;
    document.querySelector('.finance').hidden = !current.finance;
    $('finance').hidden = !p;
    facts('finance', [['Вложения CAPEX', money(p?.capexRub)], ['NPV за 5 лет', money(p?.npvRub)], ['Простая окупаемость', p?.paybackYears == null ? 'В горизонте не достигнута' : `${format(p.paybackYears)} года`], ['TCO', money(p?.tcoRub)]]);
    text('finance-status', current.financeUnavailableReason || (p && p.npvRub < 0 ? 'Покупка даёт отрицательный NPV за 5 лет. Сравните услугу RaaS и уточните допущения до решения о закупке.' : 'Финансовая оценка не подтверждает достижимость экономии на реальном объекте.'));
    const r = current.finance?.raas;
    facts('raas', r ? [['Вложения CAPEX', money(r.capexRub)], ['NPV за 5 лет', money(r.npvRub)], ['TCO', money(r.tcoRub)]] : [['Результат', 'Недостаточно данных для сравнения']]);
    const passed = current.assessment?.status === 'OK';
    const untested = current.assessment?.status === 'NOT_EVALUATED';
    text('decision-title', passed ? 'Парк выполнил задачу модели' : current.assessment?.status === 'FAIL' ? 'Выявлено нарушение модели' : untested ? 'Номинальная мощность не проверена' : 'Парк выполнил задачу частично');
    text('pilot-summary', `${current.input.robots.count} роботов и ${current.input.layout.chargers} зарядок: ${formatRate(s.achievedPerH)} из ${formatRate(s.requiredPerH)} пал./ч. Очередь к концу окна — ${s.queueEnd} заданий. ${passed ? 'Следующий шаг — сравнить затраты и денежный эффект этого состава.' : untested ? `Фактически поступило ${formatRate(s.arrivedPerH)} пал./ч. Для проверки номинальной мощности нужен прогон с достаточной нагрузкой.` : 'Сравните варианты на той же нагрузке и проверьте причины ожиданий. Увеличение парка само по себе не гарантирует роста выработки.'}`);
    text('decision-action', projectMode ? 'Передать вариант в финансовый расчёт' : financialEvaluation ? 'Изменить денежные допущения' : 'Рассчитать экономику варианта');
    text('decision-action-note', projectMode ? 'Перед передачей повторно проверим этот парк на исходной геометрии проекта. В проекте появится отдельный финансовый вариант.' : financialEvaluation ? `Доля годовой нагрузки ${format(financialEvaluation.assumptions.annualCoverageShare * 100)}%; денежная реализация труда ${format(financialEvaluation.assumptions.cashRealizationShare * 100)}%. Покупка и RaaS пересчитаны одним движком проекта.` : 'Выберите долю годовой нагрузки и денежной экономии. Расчёт покажет вложения, ежегодные расходы, оставшийся ФОТ и окупаемость покупки и RaaS.');
    if (financialEvaluation) {
      const f = financialEvaluation.purchase;
      const item = f.items[0];
      const conclusion = financialEvaluation.model.conclusion;
      text('pilot-summary', `${current.input.robots.count} роботов и ${current.input.layout.chargers} зарядок: ${formatRate(s.achievedPerH)} из ${formatRate(s.requiredPerH)} пал./ч, очередь ${s.queueEnd}. ${conclusion.headline}`);
      facts('finance', [['Вложения CAPEX', money(f.capexRub)], ['Расходы за год', money(f.opexYearRub)], ['Денежный эффект за год', money(f.effectYearRub)], ['Эксплуатация парка: доплата/год', money(f.items.reduce((sum, row) => sum + row.operatingStaffRub, 0))], ['Высвобождается труда', `${format(item?.releasedFte ?? 0)} FTE`], ['Оставшийся ФОТ за год', money(item?.remainingLabourRub)], ['NPV', money(f.npvRub)], ['Простая окупаемость', f.paybackYears == null ? 'В горизонте не достигнута' : `${format(f.paybackYears)} года`], ['TCO', money(f.tcoRub)]]);
      text('finance-status', conclusion.headline);
      let assumptions = $('finance-assumptions');
      if (!assumptions) { assumptions = document.createElement('details'); assumptions.id = 'finance-assumptions'; const summary = document.createElement('summary'); summary.textContent = 'Условия и источники расчёта'; assumptions.append(summary, document.createElement('ul')); $('finance-status').after(assumptions); }
      assumptions.querySelector('ul').replaceChildren(...financialEvaluation.assumptions.notes.map(note => { const li = document.createElement('li'); li.textContent = note; return li; }));
      assumptions.hidden = false;
    } else if ($('finance-assumptions')) {
      $('finance-assumptions').hidden = true;
    }
  }
  function renderAssessment() {
    const a = current.assessment;
    $('verdict').dataset.kind = dirty ? 'dirty' : ({ OK: 'pass', PARTIAL: 'warn', FAIL: 'fail', NOT_EVALUATED: 'neutral', RUNNING: 'neutral' }[a?.status] || 'neutral');
    text('verdict', dirty ? 'Параметры изменены — нужен пересчёт' : a?.headline || 'Результат пока не оценён');
    const cause = (a?.status === 'FAIL' && a.checks.find(c => c.category === 'safety' && c.status === 'FAIL')) || a?.checks.find(c => c.category === 'goal' && ['FAIL', 'WARN', 'NOT_EVALUATED'].includes(c.status));
    const throughputMiss = !isCleaning() && a?.status !== 'FAIL' && a?.checks.some(c => c.id === 'throughput' && c.status === 'FAIL');
    const explanation = throughputMiss ? `Доставлено ${formatRate(current.summary.achievedPerH)} пал./ч при цели ${formatRate(current.summary.requiredPerH)} пал./ч и поступлении ${formatRate(current.summary.arrivedPerH)} пал./ч. Очередь в конце: ${current.summary.queueEnd} заданий при допуске ${format(current.summary.endQueueLimit)}.` : cause ? `${cause.measuredText}. ${cause.why}` : 'Заданные критерии этого прогона выполнены. Измерения объекта и результаты пилота пока не получены.';
    text('reason', dirty ? 'Ниже сохранён предыдущий результат. Нажмите «Пересчитать сценарий», чтобы проверить новые условия.' : explanation);
    const signals = current.input.demoIncidents?.enabled ? current.input.demoIncidents.schedule.length : 0;
    text('frame-note', `Итог полного прогона до ${clockText(a?.observedAtS ?? current.summary.elapsedS ?? 0)}. Учебные сигналы в сценарии: ${signals}. Перемотка меняет только кадр ретроспективы.`);
    assessmentPanel.setModel(current);
  }
  function renderFrame(sendScene = true) {
    if (!frame || !current) return;
    if (sendScene) viewer?.setFrame(frame);
    inspection.updateFrame(frame);
    incidents.updateFrame(frame);
    renderFleetCount();
    const phase = Core.isPlaybackDone(state) ? 'окончен' : isCleaning() ? 'уборка секций' : frame.tS < frame.warmupS ? 'прогрев' : 'пиковое окно';
    text('clock', `${clockText(frame.tS)} / ${clockText(isCleaning() ? current.summary.elapsedS : frame.endS)} · ${phase}`);
    text('playback-context', `Текущий кадр ${clockText(frame.tS)} · ${phase}${isCleaning() ? ` · ${format(frame.telemetry?.cleanedM2 || 0)} м² из ${format(frame.telemetry?.targetM2 || 0)} м²` : ''}. Вывод выше относится к полному прогону.`);
    const t = frame.telemetry || {};
    text('live-active', t.activeTasks ?? '—'); text('live-wait', frame.safety ? frame.robots.filter(r => r.safety?.blocked || ['waitPoint','waitCharger','waitingDock'].includes(r.phase)).length : t.waitingRobots ?? '—');
    text('live-charge', t.chargingRobots ?? '—'); text('live-done', t.customerTasksDone ?? t.tasksDone ?? '—');
    text('live-distance', format((t.distanceM || 0) / 1000, 2));
    const origin = frame.provenance;
    if (frame.safety) text('scope-limit', isCleaning() ? 'Учитываем взаимные защитные остановки и доступные обходы. Люди, качество уборки и тормозной путь не моделируются.' : 'Учитываем габариты, защитные остановки и обходы по свободным проходам. Люди и тормозной путь не моделируются.');
    text('telemetry-origin', isCleaning() ? `Источник: модель уборки · последний шаг ${clockText(origin?.observedAtS ?? frame.tS)} · закраска из рабочего следа, не из времени анимации` : origin ? `Источник: имитация · шаг ${origin.stepS} с · последний шаг ${clockText(origin.observedAtS)} · координаты в метрах плана · маршрут плановый` : 'Источник: имитация, не реальное оборудование');
    updateSelectedRobot(); updateSelectedSection(); renderFleet(); renderTasks(); renderEvents();
    if (isCleaning()) renderSections();
    if (!rangeDragging) { $('timeline').value = frame.provenance?.observedAtS ?? frame.tS; text('timeline-value', clockText(frame.tS)); }
    const stats = viewer?.getStats?.();
    if (stats) text('render-stats', `${format(stats.drawCalls ?? stats.calls, 0)} вызовов · ${format(stats.triangles, 0)} треуг. · DPR ${format(stats.pixelRatio ?? stats.dpr, 2)} · ${format(stats.renderMs ?? stats.cpuRenderMs, 1)} мс CPU`);
  }
  const xy = p => p ? `${format(p.x)} / ${format(p.y)}` : '—';
  function updateSelectedRobot() {
    if (!selectedId?.startsWith('robot:') || !frame) return;
    const r = frame.robots.find(r => `robot:${r.id}` === selectedId);
    if (!r) return;
    text('robot-speed', format(r.vMps, 2)); text('robot-soc', `${format(r.soc * 100, 1)} %`);
    $('soc-fill').style.width = `${Math.max(0, Math.min(100, r.soc * 100))}%`;
    const history = r.socHistory || [], start = history[0]?.tS || 0, end = history.at(-1)?.tS || start;
    $('soc-path').setAttribute('d', history.map((h, i) => `${i ? 'L' : 'M'}${(240 * (h.tS - start) / Math.max(1, end - start)).toFixed(1)} ${(43 - h.soc * 40).toFixed(1)}`).join(' '));
    text('soc-range', `SOC 0–100% · ${clockText(start)} — ${clockText(end)} · отсчёт каждые 30 с модели`);
    renderProcess(r);
    if (isCleaning()) {
      const zone = frame.sections?.find(z => z.id === r.zoneId);
      facts('selection-details', [['Состояние', r.operationalState === 'incidentStop' ? 'Остановлен по инциденту' : phaseLabel(r.phase, r.underlift)], ['Манёвр', r.maneuver === 'turning' ? 'Разворот на месте' : r.maneuver === 'moving' ? 'Движение по проходу' : 'Стоянка'], ['Угловая скорость', format(Math.abs(r.angularVelocityRadS || 0) * 180 / Math.PI, 0) + ' °/с'], ['Секция / задание', zone?.label || 'Переход / база'], ['Рабочий инструмент', r.working ? 'Включён · учитывается покрытие' : 'Выключен · площадь не растёт'], ['Убрано роботом', `${format(r.cleanedM2)} м² без повторов`], ['Выполнено в секции', zone ? `${format(zone.cleanedM2)} / ${format(zone.targetM2)} м² · ${format(zone.progress)} %` : '—'], ['Положение X / Y', `${xy(r)} м`], ['Цель X / Y', r.target ? `${xy(r.target)} м` : '—'], ['Остаток маршрута / ETA', `${format(r.remainingDistM)} м / ${format(r.etaS, 0)} с`], ['Ширина рабочего следа', `${format(r.brushWidthM ?? current.input.robots.brushWidthM, 2)} м`], ['Пробег / завершено секций', `${format(r.distanceM)} м / ${r.tasksDone ?? 0}`]]);
      return;
    }
    const phases = r.timeByPhase || {};
    facts('selection-details', [['Состояние', r.operationalState === 'incidentStop' ? 'Остановлен по инциденту' : phaseLabel(r.phase, r.underlift)], ['Задание / груз', `${r.task ? `#${r.task.id}` : 'нет'} / ${r.loaded ? isRack() ? r.carrierContents === 'empty' ? 'пустой стеллаж' : 'стеллаж с грузом' : 'паллета' : 'порожний'}`], ['Положение X / Y', `${xy(r)} м`], ['Цель X / Y', r.target ? `${xy(r.target)} м` : '—'], ['До текущей точки / ETA*', `${format(r.remainingDistM)} м / ${format(r.etaS, 0)} с`], [isRack() ? 'Подхват / постановка' : 'Операция погрузки', r.handlingProgress == null ? '—' : `${format(r.handlingProgress * 100, 0)} %`], ['Путь / завершено', `${format(r.distanceM)} м / ${customerDone(r)} заявок${r.internalTasksDone ? ` · ${r.internalTasksDone} внутренних рейсов` : ''}`], ['В очередях за прогон', `${format(((phases.waitPoint || 0) + (phases.waitCharger || 0)) / 60)} мин`], ['Сейчас ожидает', r.waitReason ? `${r.waitReason} · ${format(r.waitElapsedS, 0)} с` : '—'], ['В зарядке за прогон', `${format((phases.charging || 0) / 60)} мин`], ...(isRack() ? carrierFacts(r) : [])]);
  }
  function renderFleet() {
    if (!frame) return;
    const filter = $('fleet-filter').value; let visible = 0;
    for (const r of frame.robots) {
      let row = fleetRows.get(r.id);
      if (!row) {
        row = document.createElement('tr'); row.dataset.robotId = r.id;
        for (let i = 0; i < 10; i++) row.append(document.createElement('td'));
        const button = document.createElement('button'); button.textContent = robotName(r.id);
        button.addEventListener('click', () => { viewer?.selectObject?.(`robot:${r.id}`); inspection.openRobot(r.id); }); row.cells[0].append(button);
        fleetRows.set(r.id, row); $('fleet-rows').append(row);
      }
      row.hidden = filter === 'moving' ? !(r.vMps > .001) : filter === 'waiting' ? !r.safety?.blocked && !['waitPoint','waitCharger','waitingDock'].includes(r.phase) : filter === 'charging' ? r.phase !== 'charging' : filter === 'idle' ? r.phase !== 'idle' || r.task != null || r.operationalState === 'incidentStop' : filter === 'incident' ? !r.incident : false;
      if (!row.hidden) visible++;
      row.setAttribute('aria-selected', String(selectedId === `robot:${r.id}`));
      const values = [r.operationalState === 'incidentStop' ? `Остановлен: ${r.incident?.label || 'инцидент'}` : r.incident ? `${phaseLabel(r.phase, r.underlift)} · предупреждение` : r.safety?.blocked ? phaseLabels.trafficWait : phaseLabel(r.phase, r.underlift), `${format(r.soc * 100, 1)}%`, format(r.vMps, 2), r.task ? `#${r.task.id}` : '—', xy(r.target), format(r.remainingDistM), format(r.etaS, 0), format(r.distanceM), isCleaning() ? format(r.cleanedM2) : `${customerDone(r)}${r.internalTasksDone ? ` · ${r.internalTasksDone} внутр.` : ''}`];
      values.forEach((v, i) => { const cell = row.cells[i + 1]; if (cell.textContent !== String(v)) cell.textContent = String(v); });
      row.cells[1].className = r.operationalState === 'incidentStop' ? 'state-chip incident-stop' : 'state-chip'; row.cells[1].dataset.phase = r.operationalState || r.phase;
    }
    text('fleet-count', `${visible} из ${frame.robots.length} роботов`);
  }
  function syncLiveRows(hostId, rows, items, keyFor, render, tabId) {
    const host = $(hostId), focused = host.contains(document.activeElement) ? document.activeElement : null;
    const keys = new Set(items.map(keyFor));
    for (const [key, row] of rows) if (!keys.has(key)) { row.remove(); rows.delete(key); }
    let cursor = host.firstElementChild;
    for (const item of items) {
      const key = keyFor(item), row = render(item, rows.get(key));
      rows.set(key, row);
      if (row === cursor) cursor = cursor.nextElementSibling;
      else host.insertBefore(row, cursor);
    }
    if (focused && !focused.isConnected) $(tabId).focus({ preventScroll: true });
    else if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  function clearLiveRows() {
    for (const [hostId, rows, tabId] of [['task-rows', taskRows, 'tab-tasks'], ['event-rows', eventRows, 'tab-events']]) {
      const host = $(hostId), hadFocus = host.contains(document.activeElement);
      host.replaceChildren(); rows.clear();
      if (hadFocus) $(tabId).focus({ preventScroll: true });
    }
  }
  function renderTasks() {
    if (tab !== 'tasks' || !frame) return;
    if (isCleaning()) { renderSectionTasks(); return; }
    const tasks = frame.tasks || [];
    text('task-count', `${tasks.filter(t => t.status === 'queued' && t.countsTowardDemand !== false).length} заявок в очереди · ${tasks.filter(t => t.countsTowardDemand === false || t.id < 0).length} внутренних рейсов · ${tasks.filter(t => t.status === 'active').length} назначено · показаны первые 150`);
    syncLiveRows('task-rows', taskRows, tasks.slice(0, 150), t => `task:${t.id}`, (t, row) => {
      if (!row) { row = document.createElement('tr'); row.dataset.taskId = t.id; for (let i = 0; i < 8; i++) row.append(document.createElement('td')); }
      const taskType = `${taskScope(t)} · ${taskKind(t)}${t.parentTaskId == null ? '' : ` · для #${t.parentTaskId}`}`;
      const values = [`#${t.id}`, isRack() ? `${taskType} · носитель ${t.carrierId || '—'}` : taskType, t.status === 'queued' ? 'В очереди' : ['done','completed'].includes(t.status) ? 'Завершено' : 'В работе', t.robotId == null ? '—' : `AMR-${t.robotId + 1}`, xy(t.from), xy(t.to), clockText(t.arrivalS), format(Math.max(0, (t.startS ?? frame.tS) - t.arrivalS), 0)];
      values.forEach((value, i) => { if (row.cells[i].textContent !== String(value)) row.cells[i].textContent = value; });
      return row;
    }, 'tab-tasks');
  }
  function renderEvents() {
    if (tab !== 'events' || !frame) return;
    const labels = { 'task-assigned': 'Назначено задание', 'task-completed': 'Завершено задание', 'task-incomplete': 'Секция выполнена частично', 'charge-started': 'Начата зарядка', 'charge-finished': 'Зарядка завершена' };
    const incidentStates = { reported:'Сигнал получен', acknowledged:'Инцидент принят в работу', diagnosing:'Диагностика', recovering:'Проверка восстановления', resolved:'Инцидент закрыт' };
    syncLiveRows('event-rows', eventRows, (frame.events || []).slice(-80).reverse(), e => `${typeof e.id}:${e.id}`, (e, li) => {
      if (!li) {
        li = document.createElement('li'); li.dataset.eventId = String(e.id);
        const time = document.createElement('time'), robot = document.createElement('span'), detail = document.createElement('span'), jump = document.createElement('button');
        jump.className = 'event-jump'; jump.title = 'Показать состояние после этого события';
        jump.addEventListener('click', () => seekTo(li.event.observedAtS ?? Math.floor(li.event.tS) + 1));
        time.append(jump); li.append(time, robot, detail); li.parts = { jump, robot, detail };
      }
      li.event = e;
      const { jump, robot, detail } = li.parts;
      if (jump.textContent !== clockText(e.tS)) jump.textContent = clockText(e.tS);
      const robotText = e.robotId == null ? 'Секция' : robotName(e.robotId);
      if (robot.textContent !== robotText) robot.textContent = robotText;
      const incident = (frame.incidents || []).find(i => i.id === e.incidentId);
      const incidentStatus = e.status || e.to || e.type.replace('incident-', '');
      const eventTask = e.taskId == null ? null : frame.tasks?.find(task => task.id === e.taskId) || { ...e, id: e.taskId };
      const detailText = incident ? `${incidentStates[incidentStatus] || e.type} · ${incident.label} · ${incident.code}` : e.type === 'phase' || e.type === 'underlift-stage' ? `${phaseLabel(e.from)} → ${phaseLabel(e.to)}` : `${labels[e.type] || e.type}${eventTask ? ` · ${taskScope(eventTask)} #${e.taskId}${eventTask.operation ? ` · ${taskKind(eventTask)}` : ''}${eventTask.parentTaskId == null ? '' : ` · для #${eventTask.parentTaskId}`}` : ''}`;
      if (detail.textContent !== detailText) detail.textContent = detailText;
      return li;
    }, 'tab-events');
  }
  function selectTab(value) {
    tab = value;
    for (const name of ['fleet','tasks','events','incidents']) { $(`panel-${name}`).hidden = tab !== name; $(`tab-${name}`).setAttribute('aria-selected', String(tab === name)); $(`tab-${name}`).tabIndex = tab === name ? 0 : -1; }
    renderTasks(); renderEvents(); incidents.refresh();
  }
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
  document.querySelector('.dock-tabs').addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('.dock-tabs [role=tab]')], index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
    if (target < 0) return;
    event.preventDefault(); selectTab(tabs[target].dataset.tab); tabs[target].focus();
  });
  selectTab('fleet');
  $('fleet-filter').addEventListener('change', renderFleet);
  $('quality').addEventListener('change', () => { viewer?.setQuality?.($('quality').value); renderFrame(false); });
  $('follow').addEventListener('click', () => {
    following = !following; $('follow').setAttribute('aria-pressed', String(following));
    viewer?.setFollow?.(following && selectedId?.startsWith('robot:') ? Number(selectedId.slice(6)) : null);
  });
  $('robot-inspect').addEventListener('click', () => {
    if (!selectedId?.startsWith('robot:')) return;
    following = false; $('follow').setAttribute('aria-pressed','false'); viewer?.setFollow?.(null);
    inspection.openRobot(Number(selectedId.slice(6)));
  });
  $('robot-inspect').textContent = 'Модель и работа робота';
  const fleetModelCount = document.createElement('div'); fleetModelCount.id = 'fleet-model-count'; fleetModelCount.className = 'fleet-count-note';
  document.querySelector('.live-strip').after(fleetModelCount);
  const safetyStatus = document.createElement('div'); safetyStatus.id = 'safety-status'; safetyStatus.className = 'fleet-count-note'; safetyStatus.hidden = true; fleetModelCount.after(safetyStatus);
  const safetyButton = document.createElement('button'); safetyButton.id = 'safety-zones'; safetyButton.textContent = 'Защитные контуры'; safetyButton.type = 'button'; safetyButton.setAttribute('aria-pressed','true'); safetyButton.disabled = true;
  safetyButton.addEventListener('click', () => { const show = safetyButton.getAttribute('aria-pressed') !== 'true'; safetyButton.setAttribute('aria-pressed',String(show)); viewer?.setSafetyVisible?.(show); });
  document.querySelector('.view-tools').append(safetyButton);


  function renderProcess(r) {
    const dock = ['toCharger','waitCharger','charging','toDock','waitingDock'].includes(r.phase);
    let stages, index = -1;
    if (dock) { stages = ['К станции','Очередь','Зарядка']; index = ['toCharger','toDock'].includes(r.phase) ? 0 : ['waitCharger','waitingDock'].includes(r.phase) ? 1 : 2; }
    else if (isCleaning()) { stages = ['Назначена секция','Переезд','Рабочие проходы','Секция завершена']; index = r.phase === 'working' ? 2 : r.phase === 'transit' ? 1 : r.phase === 'done' || r.phase === 'parking' ? 3 : -1; }
    else if (r.underlift) { stages = Object.values(liftStages); index = Object.keys(liftStages).indexOf(r.underlift.stage); }
    else { stages = ['К погрузке','Погрузка','Перевозка','Выгрузка','Завершено']; index = r.phase === 'toPickup' ? 0 : r.phase === 'loading' ? 1 : r.phase === 'toDrop' ? 2 : r.phase === 'unloading' ? 3 : r.phase === 'waitPoint' ? r.loaded ? 3 : 1 : -1; }
    text('task-title', dock ? 'Обслуживание · зарядная станция' : r.task ? isCleaning() ? `Задание: ${r.task.name || 'уборка секции'}` : `${taskScope(r.task)} #${r.task.id} · ${taskKind(r.task)} · ${r.task.carrierId || 'носитель не назначен'}${r.task.parentTaskId == null ? '' : ` · для #${r.task.parentTaskId}`}` : 'Текущее задание отсутствует');
    const key = stages.join('|');
    if ($('task-stages').dataset.key !== key) { $('task-stages').dataset.key = key; $('task-stages').replaceChildren(...stages.map(name => { const li = document.createElement('li'); li.textContent = name; return li; })); }
    $('task-stages').style.flexWrap = r.underlift && !dock ? 'wrap' : '';
    [...$('task-stages').children].forEach(li => { li.style.flex = r.underlift && !dock ? '1 0 22%' : ''; });
    [...$('task-stages').children].forEach((li,i) => { li.dataset.state = index >= 0 && i < index ? 'past' : 'future'; if (i === index) li.setAttribute('aria-current','step'); else li.removeAttribute('aria-current'); });
    const location = point => {
      if (!point) return '—';
      const zones = current.layout.compartments || current.layout.zones;
      const zone = zones.find(z => point.x >= z.x && point.x <= z.x + z.w && point.y >= z.y && point.y <= z.y + z.h);
      return `${zone?.label || 'Точка'} (${xy(point)} м)`;
    };
    text('task-route-note', r.task ? isCleaning() ? 'Покрытие учитывается только при включённом инструменте внутри назначенной секции. Переходы и повторные проходы новые м² не добавляют.' : `Откуда: ${location(r.task.from)} → куда: ${location(r.task.to)}. ${r.waitReason || ''}` : dock ? `Цель: ${location(r.target)}. ${r.waitReason || 'Заряд меняется по модели аккумулятора.'}` : 'Выберите событие в журнале или момент на шкале, чтобы увидеть выполнение задания.');
    const progress = r.underlift?.progress ?? r.handlingProgress;
    const operation = !isCleaning() && progress != null;
    $('operation-meter').hidden = !operation;
    if (operation) { $('operation-progress').value = progress * 100; text('operation-label', `${phaseLabel(r.phase, r.underlift)} · ${format(progress * 100,0)} %`); }
  }

  function renderCleaningResult() {
    const s = current.summary;
    text('required', `${format(s.targetM2, 0)} м²`); text('achieved', `${format(s.cleanedM2)} м² · ${format(s.coveragePct, 0)}%`); text('queue', `${s.completedSections} / ${s.totalSections}`);
    renderAssessment();
    facts('facts', [['Парк / секции', `${current.input.robots.count} / ${s.totalSections}`], ['Доступная площадь задания', `${format(s.targetM2)} м²`], ['Выполнено / осталось', `${format(s.cleanedM2)} / ${format(Math.max(0,s.targetM2-s.cleanedM2))} м²`], ['Средняя за прогон', `${format(s.achievedM2PerH, 0)} м²/ч`], ['Источник', 'Модель покрытия, не отчёт вендора']]);
    text('decision-title', current.assessment.status === 'OK' ? 'Задание уборки выполнено в модели' : 'Задание уборки выполнено не полностью');
    text('pilot-summary', `${s.completedSections} из ${s.totalSections} секций, ${format(s.cleanedM2)} из ${format(s.targetM2)} м². Осталось ${format(Math.max(0, s.targetM2 - s.cleanedM2))} м². Качество мытья и ручные вмешательства нужно проверить на объекте.`);
    $('decision-action').hidden = true; $('decision-compare').hidden = true; text('decision-action-note', 'Этот дополнительный сценарий показывает покрытие секций. Экономический подбор основного продукта относится к перевозке паллет.');
  }
  function renderSections() {
    if (!isCleaning() || !frame?.sections) return;
    for (const z of frame.sections) {
      let row = sectionRows.get(z.id);
      if (!row) {
        row = document.createElement('button'); row.type = 'button'; row.className = 'section-button'; row.dataset.section = z.id;
        const line = document.createElement('span'), name = document.createElement('b'), pct = document.createElement('b'), detail = document.createElement('small'), track = document.createElement('i'), fill = document.createElement('i');
        track.className = 'section-track'; line.append(name,pct); track.append(fill); row.append(line,detail,track);
        row.addEventListener('click', () => viewer?.focus(`section:${z.id}`)); row.parts = {name,pct,detail,fill}; sectionRows.set(z.id,row); $('section-list').append(row);
      }
      const p = row.parts; p.name.textContent = z.label; p.pct.textContent = `${format(z.progress, 0)}%`;
      p.detail.textContent = `${z.robotId == null ? 'Ожидает робота' : robotName(z.robotId)} · ${format(z.cleanedM2,0)} / ${format(z.targetM2,0)} м²`;
      p.fill.style.width = `${Math.max(0,Math.min(100,z.progress))}%`; row.setAttribute('aria-pressed', String(selectedId === `section:${z.id}`));
    }
  }
  function updateSelectedSection() {
    if (!isCleaning() || !selectedId?.startsWith('section:')) return;
    const z = frame?.sections?.find(z => `section:${z.id}` === selectedId); if (!z) return;
    facts('selection-details', [['Задание', z.label], ['Состояние', sectionStatus[z.status] || z.status], ['Назначен', z.robotId == null ? 'В очереди' : robotName(z.robotId)], ['Доступный пол', `${format(z.targetM2)} м²`], ['Убрано без повторов', `${format(z.cleanedM2)} м²`], ['Осталось', `${format(Math.max(0,z.targetM2-z.cleanedM2))} м²`], ['Покрытие задания', `${format(z.progress)} %`]]);
  }
  function renderSectionTasks() {
    const zones = frame.sections || [];
    text('task-count', `${zones.length} заданий по секциям · площадь без стен, оборудования и недоступных ячеек`);
    syncLiveRows('task-rows', taskRows, zones, z => `section:${z.id}`, (z, tr) => {
      if (!tr) {
        tr = document.createElement('tr'); tr.dataset.section = z.id;
        for (let i = 0; i < 8; i++) tr.append(document.createElement('td'));
        const button = document.createElement('button'); button.className = 'section-task-button';
        button.addEventListener('click', () => viewer?.focus(`section:${z.id}`)); tr.cells[0].append(button);
      }
      const button = tr.cells[0].firstElementChild;
      if (button.textContent !== z.label) button.textContent = z.label;
      const values = [format(z.targetM2), sectionStatus[z.status] || z.status, z.robotId == null ? '—' : robotName(z.robotId), format(z.cleanedM2), format(Math.max(0,z.targetM2-z.cleanedM2)), `${format(z.progress)} %`, z.startS == null ? '—' : clockText(z.startS)];
      values.forEach((value, i) => { if (tr.cells[i + 1].textContent !== String(value)) tr.cells[i + 1].textContent = value; });
      return tr;
    }, 'tab-tasks');
  }

  function makeTree() {
    treeEntries = isCleaning() ? current.sections.map(z => ({ id: `section:${z.id}`, name: z.label })) : current.layout.zones.map(z => ({ id: `zone:${z.kind}`, name: z.label }));
    for (const p of [...current.layout.receiving, ...current.layout.shipping, ...current.layout.chargers]) {
      treeEntries.push({ id: `point:${p.id}`, name: `${p.kind === 'charger' ? 'Зарядная станция' : p.kind === 'receiving' ? 'Ворота приёмки' : 'Ворота отгрузки'} ${p.id}` });
    }
    for (let i = 0; i < current.input.robots.count; i++) treeEntries.push({ id: `robot:${i}`, name: `Робот ${i + 1}` });
    current.racks.forEach((_, i) => treeEntries.push({ id: `rack:${i}`, name: `Стеллажный блок ${i + 1}` }));
    renderTree();
  }
  function renderTree() {
    const query = $('object-search').value.trim().toLocaleLowerCase('ru');
    const entries = treeEntries.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase('ru').includes(query));
    const nodes = entries.slice(0, 70).map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
      button.setAttribute('aria-pressed', String(selectedId === item.id));
      button.addEventListener('click', () => { if (item.id.startsWith('robot:')) { viewer?.selectObject?.(item.id); inspection.openRobot(Number(item.id.slice(6))); } else viewer?.focus(item.id); }); return button;
    });
    if (entries.length > 70) { const hint = document.createElement('small'); hint.textContent = `Показано 70 из ${entries.length}. Уточните поиск.`; nodes.push(hint); }
    $('object-tree').replaceChildren(...nodes);
  }
  function installModel(result, id, { modified = false, preserveComparison = false } = {}) {
    financialEvaluation = null;
    $('decision-action').hidden = result.kind === 'cleaning'; $('decision-compare').hidden = result.kind === 'cleaning';
      current = result; activeCase = id; selectedId = null; $('selection').hidden = true;
      document.querySelectorAll('[data-check]').forEach(input => { input.checked = false; });
      clearLiveRows();
      document.querySelector('.finance').hidden = !result.finance;
      incidents.setModel(result);
      inspection.setModel(result, id);
      $('fleet').value = result.input.robots.count;
      const cleaning = isCleaning();
      const measureCheck = document.querySelector('[data-check="measure"]');
      measureCheck.parentElement.replaceChildren(measureCheck, document.createTextNode(cleaning ? 'Замерить уникальное покрытие, качество уборки, повторы, ручные вмешательства и зарядку.' : 'Замерить цикл с грузом и без груза, зарядку, очередь и фактический поток.'));
      document.body.dataset.domain = cleaning ? 'cleaning' : 'warehouse';
      $('peak-field').hidden = cleaning; $('peak').disabled = cleaning; $('peak').required = !cleaning;
      $('fleet').max = cleaning ? 8 : 60; $('area').min = cleaning ? 1000 : 5000; $('area').max = cleaning ? 10000 : 50000;
      $('peak').value = cleaning ? 1.5 : format(result.input.demand.peakPerH / result.input.demand.avgPerH, 3).replace(',', '.').replaceAll('\u00a0', '');
      $('area').value = cleaning ? result.activeAreaM2 : result.input.layout.activeAreaM2;
      $('sections-panel').hidden = !cleaning; $('coverage-legend').hidden = !cleaning; $('warehouse-legend').hidden = cleaning;
      $('warehouse-examples').hidden = true; $('input-details').open = !cleaning && !matchMedia('(max-width:650px)').matches;
      $('demo-link').href = viewerUrl(cleaning ? 'warehouse' : 'cleaning');
      text('demo-link', cleaning ? 'Основное демо: склад' : 'Дополнительно: уборка');
      sectionRows.clear(); $('section-list').replaceChildren();
      text('page-title', cleaning ? 'Работа роботов внутри секций' : 'Склад. Поток. Состояние каждого робота.');
      text('header-context', cleaning ? 'Дополнительная модель уборки · все параметры условные' : 'Перевозка грузов · полный цикл мобильных стеллажей');
      text('scope-note', cleaning ? 'Моделируем выполнение уборки в пяти секциях: доступный пол, рабочие полосы, переезды и зарядку. Покрытие — уникальная площадь пройденных рабочих ячеек.' : 'Проверяем поток, очереди и зарядку на типовой планировке. Прохождение модели — основание для обследования и пилота.');
      text('scope-limit', cleaning ? 'Геометрия и робот условные. Качество мытья, люди и взаимное уклонение роботов не моделируются.' : 'Поставленные носители остаются на полу; подача и возврат проходят по маршрутам. Подача и возврат — внутренние рейсы; они занимают роботов, но не увеличивают выполненный клиентский поток. Габариты и контактная механика — допущения модели; учёт нагрузки остаётся в паллетах.');
      text('result-title', 'Итог полного прогона');
      text('required-label', cleaning ? 'Площадь задания' : 'Нужно перемещать');
      text('achieved-label', cleaning ? 'Убрано за прогон' : 'Завершено за час');
      text('queue-label', cleaning ? 'Секции завершены' : 'Максимальная очередь');
      text('live-done-label', cleaning ? 'секций выполнено' : 'заявок выполнено');
      text('fleet-done-heading', cleaning ? 'УБРАНО, М²' : 'ЗАЯВКИ / ВНУТР. РЕЙСЫ');
      const heads = cleaning ? ['СЕКЦИЯ','ЗАДАНИЕ, М²','СОСТОЯНИЕ','РОБОТ','УБРАНО, М²','ОСТАЛОСЬ, М²','ПРОГРЕСС','НАЧАТО'] : ['ЗАДАНИЕ','ТИП','СТАТУС','РОБОТ','ОТКУДА X / Y','КУДА X / Y','СОЗДАНО','ОЖИДАНИЕ, С'];
      const headrow = document.createElement('tr'); heads.forEach(v => { const th = document.createElement('th'); th.textContent = v; headrow.append(th); }); $('task-head').replaceChildren(headrow);
      document.querySelectorAll('[data-case]').forEach(b => b.setAttribute('aria-pressed', String(!modified && b.dataset.case === id)));
      text('case-context', `${modified ? 'Изменённые условия' : result.title} · ${format(cleaning ? result.activeAreaM2 : result.input.layout.activeAreaM2, 0)} м² · парк: ${result.input.robots.count} · ${result.product.name}`);
      text('dimensions', `${format(result.layout.widthM)} × ${format(result.layout.heightM)} м`);
      text('input-note', cleaning ? `Объект ${format(result.activeAreaM2)} м²; доступный пол задания ${format(result.summary.targetM2)} м². Стены, оборудование, защитные отступы и недоступные клетки исключены. Параметры робота — допущения.` : `Средняя нагрузка ${format(result.input.demand.avgPerH)} пал./ч × пиковый коэффициент ${format(result.input.demand.peakPerH / result.input.demand.avgPerH, 2)} = ${format(result.input.demand.peakPerH)} пал./ч. ${result.input.layout.chargers} зарядных станций по опорному расчёту. ${carrier().sourceNote}`);
      text('speed-note', cleaning ? `×1 — реальное время. Ускорение обзора: ×5, ×10, ×50, ×500. Уборка ${format(result.input.robots.speedMps, 2)} м/с, переход ${format(result.input.robots.transitSpeedMps, 2)} м/с; след ${format(result.input.robots.brushWidthM, 2)} м. Только рабочее движение увеличивает покрытие.` : `×1 — секунда модели за секунду реального времени. ×5, ×10, ×50 и ×500 ускоряют воспроизведение. Скорость робота: ${format(result.input.robots.speedMps, 2)} м/с без груза, ${format(result.input.robots.speedMps * result.input.robots.loadedSpeedFactor, 2)} м/с с грузом.`);
      text('versions', `Модель ${result.modelVersion || 'платформы'}, имитация ${result.simModelVersion || result.summary.simModelVersion}, seed ${result.input.seed}.`);
      text('source-note', result.sources.join(' '));
      $('assumptions').replaceChildren(...[...result.assumptions, ...config.visualAssumptions].map(value => { const li = document.createElement('li'); li.textContent = value; return li; }));
      selectedId = null; $('selection').hidden = true;
      viewer?.setModel(result); resetView(); makeTree();
      fleetRows.clear(); $('fleet-rows').replaceChildren();
      state = Core.createPlayback(current.input); Core.stepPlayback(state, Math.min(cleaning ? 180 : 1200, state.endS));
      $('timeline').max = Math.ceil(cleaning ? result.summary.elapsedS : state.endS);
      $('timeline').step = cleaning ? '0.1' : '1';
      frame = Core.playbackFrame(state); mode = 'play'; carry = 0; last = 0;
      renderFrame();
      comparisonPanel.setModel(result, { preserveComparison });
      if (result.projectOrigin) {
        text('header-context', 'Пространственная проверка снимка выбранного сценария');
        text('case-context', `${result.title} · ${result.input.robots.count} роботов · базовый прогон без учебных инцидентов`);
        text('input-note', 'Параметры получены из проекта и здесь доступны только для чтения. Правьте исходный сценарий и откройте новый снимок. Сравнение парков ниже проверяет отдельные варианты и не изменяет проект.');
        $('presets').hidden = true; $('recalculate').hidden = true; $('demo-link').href = viewerUrl('warehouse'); text('demo-link', 'Открыть отдельное демо');
      }
      setDirty(false);
      setTimeout(() => { if (!playing) renderFrame(false); }, 700);
      document.body.dataset.ready = 'true';
  }
  async function calculate(id, overrides, updateCaseUrl = false) {
    if (busy || comparing || projectMode) return;
    playing = false; setBusy(true); text('input-error', '');
    try {
      await nextPaint();
      const result = await calculateOffscreen(id, overrides);
      installModel(result, id, { modified: Boolean(overrides) });
      if (updateCaseUrl) {
        const url = new URL(location.href); url.searchParams.set('case', id);
        window.history.replaceState(window.history.state, '', url);
      }
    } catch (error) {
      text('input-error', `Не удалось проверить условия: ${error.message}`);
      if (!current) text('verdict', 'Проверка не выполнена');
    } finally { setBusy(false); }
  }
  $('parameters').addEventListener('input', () => setDirty(true));
  $('parameters').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('parameters').reportValidity()) return;
    calculate(activeCase, { fleet: Number($('fleet').value), ...(!isCleaning() ? { peakFactor: Number($('peak').value) } : {}), areaM2: Number($('area').value) }, true);
  });
  function resetPlayback() {
    state = Core.createPlayback(current.input); carry = 0; last = 0; frame = Core.playbackFrame(state); mode = 'play'; renderFrame();
  }
  $('play').addEventListener('click', () => {
    if (!current) return;
    if (mode === 'final' || Core.isPlaybackDone(state)) resetPlayback();
    playing = true; last = 0; updateControls(); scheduleTick();
  });
  $('pause').addEventListener('click', () => { playing = false; last = 0; updateControls(); });
  $('restart').addEventListener('click', () => { if (current) { playing = false; resetPlayback(); updateControls(); } });
  $('finish').addEventListener('click', () => { if (current) seekTo(Number($('timeline').max)); });
  $('speed').addEventListener('change', () => { speed = Number($('speed').value); last = 0; });
  document.addEventListener('visibilitychange', () => { last = 0; if (!document.hidden) scheduleTick(); });
  async function seekTo(seconds) {
    if (!current || busy || seeking) return;
    const target = Math.max(0, Math.min(Number($('timeline').max), isCleaning() ? Math.round(seconds * 10) / 10 : Math.floor(seconds)));
    seeking = true; playing = false; last = 0; carry = 0; setBusy(true);
    try {
      await nextPaint();
      state = Core.createPlayback(current.input);
      let checkpoint = performance.now();
      while (state.tS < target && !Core.isPlaybackDone(state)) {
        Core.stepPlayback(state, Math.min(30, target - state.tS));
        if (performance.now() - checkpoint > 12) { await nextPaint(); checkpoint = performance.now(); }
      }
      frame = Core.playbackFrame(state); mode = Core.isPlaybackDone(state) ? 'final' : 'play'; renderFrame();
    } catch (error) { text('input-error', `Не удалось восстановить момент: ${error.message}`); }
    finally { seeking = false; rangeDragging = false; setBusy(false); }
  }
  $('timeline').addEventListener('input', () => { rangeDragging = true; playing = false; last = 0; text('timeline-value', clockText(Number($('timeline').value))); updateControls(); });
  $('timeline').addEventListener('change', () => { rangeDragging = false; seekTo(Number($('timeline').value)); });
  $('back-minute').addEventListener('click', () => seekTo((frame?.tS || 0) - 60));
  $('forward-minute').addEventListener('click', () => seekTo((frame?.tS || 0) + 60));
  function scheduleTick() { if (!animation && playing && !document.hidden) animation = requestAnimationFrame(tick); }
  function tick(now) {
    animation = 0;
    if (!playing || !state || document.hidden) { last = 0; return; }
    carry += last ? Math.max(0, (now - last) / 1000) * speed : 0; last = now;
    const deadline = performance.now() + 10;
    while (carry >= 1 && !Core.isPlaybackDone(state) && performance.now() < deadline) { Core.stepPlayback(state); carry -= 1; }
    if (now - lastScene >= 1000 / 30 || Core.isPlaybackDone(state)) {
      frame = Core.previewInterpolate ? Core.previewInterpolate(state, Math.min(carry, 1)) : Core.playbackFrame(state);
      viewer?.setFrame(frame); lastScene = now;
    }
    if (now - lastUi >= 250) { renderFrame(false); lastUi = now; }
    if (Core.isPlaybackDone(state)) { playing = false; mode = 'final'; carry = 0; renderFrame(); updateControls(); }
    scheduleTick();
  }
  function resetView() {
    following = false; $('follow').setAttribute('aria-pressed', 'false'); viewer?.setFollow?.(null);
    currentLayer = 'all'; viewer?.setLayer('all'); viewer?.setSlice(null); viewer?.setView('iso'); viewer?.reset();
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === 'iso')));
    document.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    $('slice-toggle').setAttribute('aria-pressed', 'false'); $('slice-controls').hidden = true;
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    viewer?.setView(button.dataset.view);
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  }));
  document.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => {
    currentLayer = currentLayer === button.dataset.layer ? 'all' : button.dataset.layer;
    viewer?.setLayer(currentLayer);
    document.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layer === currentLayer)));
  }));
  $('reset-view').addEventListener('click', resetView);
  $('isolate').textContent = 'Общий вид';
  $('isolate').addEventListener('click', () => { resetView(); $('selection').hidden = true; selectedId = null; renderTree(); });
  $('slice-toggle').addEventListener('click', () => {
    const on = $('slice-controls').hidden; $('slice-controls').hidden = !on;
    $('slice-toggle').setAttribute('aria-pressed', String(on)); viewer?.setSlice(on ? Number($('slice-height').value) : null);
  });
  $('slice-height').addEventListener('input', () => { const value = Number($('slice-height').value); text('slice-value', `${format(value)} м`); viewer?.setSlice(value); });
  $('object-search').addEventListener('input', renderTree);
  for (const value of ['decision', 'technical']) $(value + '-mode').addEventListener('click', () => {
    document.body.dataset.audience = value;
    $('decision-mode').setAttribute('aria-pressed', String(value === 'decision'));
    $('technical-mode').setAttribute('aria-pressed', String(value === 'technical'));
    $('technical').open = value === 'technical'; viewer?.resize();
  });
  function download(data, type, name) {
    const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportData() {
    if (!current || dirty || busy || comparing) return;
    const checklist = Object.fromEntries([...document.querySelectorAll('[data-check]')].map(input => [input.dataset.check, input.checked]));
    download(JSON.stringify({ schemaVersion: config.schemaVersion, exportedAt: new Date().toISOString(), ...current, playback: frame, fleetComparison: comparisonPanel.snapshot(), visualAssumptions: config.visualAssumptions, pilotPlan: Core.buildPilotPlan(current), pilotChecklist: checklist }, null, 2), 'application/json', `alfa-robot-${activeCase}.json`);
  }
  $('export-json').addEventListener('click', exportData); $('pilot-download').addEventListener('click', exportData);
  $('export-png').addEventListener('click', () => {
    if (!viewer || dirty) return;
    try {
      const png = viewer.capturePng();
      if (!png) throw new Error('3D-сцена недоступна');
      const link = document.createElement('a'); link.href = png; link.download = `alfa-robot-${activeCase}-scene.png`; link.click();
    }
    catch (error) { text('input-error', `Не удалось выгрузить схему: ${error.message}`); }
  });
  $('report-top').addEventListener('click', () => {
    if (!current || dirty) return;
    const png = viewer?.capturePng();
    if (png) $('print-scene').src = png;
    window.print();
  });
  function projectResult(result, snapshot) {
    const a = result.assessment, s = result.summary;
    return { type: 'spatial-project-result', requestId: snapshot.requestId, sourceInputKey: snapshot.inputKey, executionInputKey: result.projectOrigin.executionInputKey, simModelVersion: result.simModelVersion, modified: false, assessment: { status: a.status, headline: a.headline, terminal: a.terminal }, summary: { fleet: s.fleet, requiredPerH: s.requiredPerH, achievedPerH: s.achievedPerH, queueEnd: s.queueEnd, waitP95Min: s.waitP95Min } };
  }
  $('decision-compare').addEventListener('click', () => {
    const host = $('fleet-comparison'); host.open = true;
    host.scrollIntoView({ block: 'start', behavior: 'instant' }); $('comparison-max').focus({ preventScroll: true });
  });
  const financeConditions = window.createFinanceConditions($('finance-form'));
  $('decision-action').addEventListener('click', async () => {
    if (!current || busy || comparing || dirty || !['OK','PARTIAL'].includes(current.assessment.status)) return;
    if (projectMode) {
      if (!projectSnapshot || !window.opener || window.opener.closed) { text('input-error', 'Исходная вкладка проекта закрыта. Откройте проверку заново из проекта.'); return; }
      setBusy(true);
      try {
        const input = structuredClone(projectSnapshot.input);
        input.robots.count = current.input.robots.count; input.layout.chargers = current.input.layout.chargers;
        const candidate = Core.createSpatialProjectSnapshot({ ...projectSnapshot, input });
        const verified = await calculateOffscreen('project', candidate);
        if (!['OK','PARTIAL'].includes(verified.assessment.status)) throw new Error('Повторная проверка обнаружила нарушение. Разберите его до финансового сравнения.');
        window.opener.postMessage({ type: 'spatial-scenario-proposal', requestId: candidate.requestId, originalInputKey: projectSnapshot.inputKey, candidate, result: projectResult(verified, candidate) }, location.origin);
        text('decision-action-note', 'Вариант передан в исходную вкладку проекта. Укажите годовые допущения и нажмите «Создать финансовый вариант».');
        window.opener.focus();
      } catch (error) { text('input-error', error.message); }
      finally { setBusy(false); }
    } else {
      const s = current.summary;
      $('annual-coverage').value = financialEvaluation ? financialEvaluation.assumptions.annualCoverageShare * 100 : Math.floor(Math.min(1, s.requiredPerH > 0 ? s.achievedPerH / s.requiredPerH : 0) * 10000) / 100;
      $('cash-realization').value = financialEvaluation ? financialEvaluation.assumptions.cashRealizationShare * 100 : 0;
      financeConditions.write(financialEvaluation?.assumptions, current.input.layout.chargers);
      $('finance-accepted').checked = false; text('finance-error', '');
      text('finance-context', `${current.input.robots.count} роботов, ${current.input.layout.chargers} зарядок. Модель: ${formatRate(s.achievedPerH)} из ${formatRate(s.requiredPerH)} пал./ч. Цены и нормативы — текущий демонстрационный набор организатора. Перед расчётом повторно проверим выбранный парк на исходной геометрии.`);
      $('finance-dialog').showModal(); $('finance-dialog').scrollTop = 0;
    }
  });
  $('finance-cancel').addEventListener('click', () => $('finance-dialog').close());
  $('finance-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || comparing || dirty || !$('finance-accepted').checked || !$('finance-form').reportValidity()) return;
    const assumptions = { annualCoverageShare: Number($('annual-coverage').value) / 100, cashRealizationShare: Number($('cash-realization').value) / 100 };
    setBusy(true);
    try {
      Object.assign(assumptions, financeConditions.read());
      const verified = await calculateOffscreen('financial-candidate', current);
      installModel(verified, activeCase, { modified: true });
      financialEvaluation = Core.calculateSpatialFinance(current, assumptions);
      current.finance = { purchase: financialEvaluation.purchase, raas: financialEvaluation.raas };
      current.financialModel = financialEvaluation.model; current.financialAssumptions = financialEvaluation.assumptions;
      renderResult(); $('finance-dialog').close();
      document.querySelector('.finance').scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } catch (error) { text('finance-error', error.message); }
    finally { setBusy(false); }
  });
  $('pilot-open').addEventListener('click', () => {
    text('pilot-context', isCleaning() ? `${current.input.robots.count} робота, ${current.sections.length} секций. На пилоте проверить уникальную убранную площадь, качество, время, ручные вмешательства, зарядку и доступность каждой секции. Сейчас показана модель, не отчёт реальных роботов.` : `${current.product.name}: ${current.input.robots.count} роботов, ${current.input.layout.chargers} зарядок. Требуемый поток ${formatRate(current.summary.requiredPerH)} пал./ч; достигнуто ${formatRate(current.summary.achievedPerH)} пал./ч. Геометрию и условия нужно подтвердить обследованием.`);
    const plan = Core.buildPilotPlan(current);
    let host = $('pilot-plan');
    if (!host) { host = document.createElement('section'); host.id = 'pilot-plan'; $('pilot-context').after(host); }
    const title = document.createElement('h3'); title.textContent = plan.title;
    const note = document.createElement('p'); note.textContent = plan.conclusion;
    const list = document.createElement('ul');
    for (const item of plan.blockers) { const li = document.createElement('li'); li.textContent = `${item.label}: ${item.measured}. Требование: ${item.required}. ${item.nextAction}`; list.append(li); }
    const more = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Порядок пилота и данные для экономики';
    const steps = document.createElement('ol'); for (const value of plan.steps) { const li = document.createElement('li'); li.textContent = value; steps.append(li); }
    const economics = document.createElement('p'); economics.textContent = plan.economics.reason;
    const missing = document.createElement('ul'); for (const value of plan.economics.requiredEvidence) { const li = document.createElement('li'); li.textContent = value; missing.append(li); }
    more.append(summary, steps, economics, missing); host.replaceChildren(title, note, list, more);
    $('pilot-dialog').showModal();
    $('pilot-dialog').scrollTop = 0;
  });
  $('pilot-close').addEventListener('click', () => $('pilot-dialog').close());
  window.addEventListener('pagehide', () => { cancelAnimationFrame(animation); calculationWorker?.terminate(); if (workerUrl) URL.revokeObjectURL(workerUrl); comparisonPanel.dispose(); incidents.dispose(); inspection.dispose(); viewer?.dispose(); });
  window.warehouseDemo = { calculationMode: () => calculationWorker ? 'worker' : 'main', comparisonStats: () => comparisonPanel.stats(), fleetComparison: () => comparisonPanel.snapshot(), stats: () => viewer?.getStats?.(), detailStats: () => inspection.getStats(), workHistory: () => inspection.getHistory(), projectRobot: id => viewer?.projectRobot?.(id), projectObject: id => viewer?.projectObject?.(id), snapshot: () => JSON.parse(JSON.stringify({ caseId: activeCase, input: current?.input, summary: current?.summary, assessment: current?.assessment, projectOrigin: current?.projectOrigin, comparisonOrigin: current?.comparisonOrigin, frame, playing, mode, speed, dirty, busy, comparing })) };
  if (matchMedia('(max-width:650px)').matches) $('input-details')?.removeAttribute('open');
  let projectMessageHandler = null, projectTimer = null;
  if (projectMode) {
    setBusy(true); text('page-title', 'Проверка снимка проекта');
    text('verdict', 'Ожидаем вход выбранного сценария');
    $('presets').hidden = true; $('recalculate').hidden = true;
    const failProject = message => {
      clearTimeout(projectTimer); setBusy(false); text('input-error', message); text('verdict', 'Снимок проекта не загружен');
      if (location.origin !== 'null') window.opener?.postMessage({ type: 'spatial-project-error', requestId: projectRequestId, message }, location.origin);
    };
    if (!window.opener || location.origin === 'null' || !/^[a-zA-Z0-9-]{1,100}$/.test(projectRequestId || '')) {
      failProject('Откройте пространственную проверку кнопкой из рассчитанного сценария проекта. Демонстрационные данные вместо снимка не подставляются.');
    } else {
      projectMessageHandler = async event => {
        if (event.source !== window.opener || event.origin !== location.origin || event.data?.type !== 'spatial-project-snapshot' || event.data.requestId !== projectRequestId) return;
        window.removeEventListener('message', projectMessageHandler); clearTimeout(projectTimer);
        try {
          if (event.data.payload?.requestId !== projectRequestId) throw new Error('Идентификатор снимка не совпал с запросом.');
          projectSnapshot = Core.createSpatialProjectSnapshot(event.data.payload);
          const result = await calculateOffscreen('project', projectSnapshot);
          installModel(result, 'project'); setBusy(false);
          window.opener.postMessage(projectResult(result, projectSnapshot), location.origin);
        } catch (error) { failProject(`Не удалось проверить снимок: ${error.message}`); }
      };
      window.addEventListener('message', projectMessageHandler);
      projectTimer = setTimeout(() => { window.removeEventListener('message', projectMessageHandler); failProject('Снимок проекта не получен. Откройте проверку повторно из исходной вкладки.'); }, 30000);
      window.opener.postMessage({ type: 'spatial-project-ready', requestId: projectRequestId }, location.origin);
    }
  } else calculate(activeCase);
  window.addEventListener('pagehide', () => { clearTimeout(projectTimer); if (projectMessageHandler) window.removeEventListener('message', projectMessageHandler); });
})();
