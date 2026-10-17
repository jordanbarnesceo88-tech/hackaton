/* global WarehouseDemoCore */
(function () {
  'use strict';
  const Core = WarehouseDemoCore;
  const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const num = value => Number.isFinite(value) ? formatter.format(value) : '—';
  const flowFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  function flowPair(actual, target) {
    let f = flowFormatter, digits = 2;
    while (digits < 8 && actual + 1e-8 < target && f.format(actual) === f.format(target)) f = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: ++digits });
    return `${f.format(actual)} / ${f.format(target)}`;
  }
  const labels = { OK: 'Критерии выполнены', PARTIAL: 'Цель выполнена не полностью', FAIL: 'Нарушены правила модели', NOT_EVALUATED: 'Недостаточно данных', RUNNING: 'Прогон не завершён' };
  const kinds = { OK: 'pass', PARTIAL: 'warn', FAIL: 'fail', NOT_EVALUATED: 'neutral', RUNNING: 'neutral' };
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  window.createFleetComparisonPanel = function ({ onBusy, onApply }) {
    const $ = id => document.getElementById(id), host = $('fleet-comparison');
    let model = null, reference = null, result = null, context = null, worker = null, workerUrl = null;
    let working = false, externalBusy = false, modelDirty = false, settingsDirty = false, generation = 0, completed = 0, total = 0, nextFleet = null;
    let error = '', lastProgress = null;
    const rows = new Map(), runs = new Map();

    function releaseWorker() {
      worker?.terminate(); worker = null;
      if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
    }
    function contextKey() { return result?.context.contextKey || context?.contextKey; }
    function appliedFleet() { const key = contextKey(); return model && key && model.comparisonOrigin?.contextKey === key ? model.input.robots.count : null; }
    function canShow(run) { return !working && !externalBusy && !modelDirty && !settingsDirty && result && result.status !== 'INVALID' && run.status === 'COMPLETE' && run.workloadMatched && run.assessment?.terminal; }
    function rowFor(run) {
      let row = rows.get(run.fleet);
      if (!row) {
        row = node('tr'); row.dataset.fleet = run.fleet;
        for (let i = 0; i < 7; i++) row.append(node('td'));
        const state = node('span', '', 'comparison-row-state'), button = node('button', 'Просмотреть прогон', 'comparison-show');
        button.type = 'button'; button.dataset.fleet = run.fleet;
        button.addEventListener('click', async () => {
          const currentRun = runs.get(run.fleet);
          if (!currentRun || !canShow(currentRun)) return;
          try {
            const candidate = Core.applyFleetComparison(reference, result, run.fleet);
            await onApply(candidate);
          } catch (failure) { error = `Не удалось открыть этот прогон: ${failure.message}`; render(); }
        });
        row.cells[5].append(state); row.cells[6].append(button); row.parts = { state, button };
        rows.set(run.fleet, row); $('comparison-rows').append(row);
      }
      const s = run.summary, a = run.assessment;
      const safety = a?.checks.filter(c => c.category === 'safety') || [];
      const rules = !a ? '—' : safety.some(c => c.status === 'FAIL') ? 'Есть нарушение' : safety.some(c => c.status === 'NOT_EVALUATED') ? 'Проверка неполная' : 'Нарушений не выявлено';
      const limit = a?.checks.find(c => c.id === 'intake_sla')?.limit;
      const values = [run.fleet, s ? flowPair(s.achievedPerH, s.requiredPerH) : '—', s ? `${num(s.queueEnd)} / ${num(s.endQueueLimit)}` : '—', s ? `${num(s.waitP95Min)} / ${num(limit?.waitToStartP95MaxMin)}` : '—', rules];
      values.forEach((v, i) => { if (row.cells[i].textContent !== String(v)) row.cells[i].textContent = v; });
      row.parts.state.textContent = run.status === 'INELIGIBLE' ? 'Неприменимо: сигналы для роботов 1–4' : run.status === 'INTERRUPTED' ? 'Не досчитан' : labels[a?.status] || 'Оценки нет';
      row.parts.state.dataset.kind = run.status === 'COMPLETE' ? kinds[a?.status] || 'neutral' : 'neutral';
      row.parts.state.title = a?.headline || '';
      const applied = appliedFleet() === run.fleet;
      row.dataset.applied = String(applied);
      row.parts.button.textContent = applied ? 'На карте' : 'Просмотреть прогон';
      row.parts.button.disabled = !canShow(run) || applied;
      row.parts.button.setAttribute('aria-label', `${applied ? 'На карте' : 'Просмотреть прогон'}: парк ${run.fleet}. ${row.parts.state.textContent}`);
      return row;
    }
    function render() {
      host.hidden = !model || model.kind === 'cleaning';
      $('comparison-max').disabled = working || externalBusy || modelDirty;
      $('comparison-fault-mode').disabled = working || externalBusy || modelDirty;
      $('comparison-start').disabled = working || externalBusy || modelDirty || !model || typeof Worker !== 'function';
      $('comparison-cancel').disabled = !working;
      $('comparison-progress').max = Math.max(1, total); $('comparison-progress').value = completed;
      const active = appliedFleet();
      $('comparison-applied').textContent = active === null ? `На 3D остаётся исходный сценарий: парк ${model?.input.robots.count ?? '—'}. Таблица сама не переключает карту.` : `На 3D открыт проверенный прогон: парк ${active}, ${result?.context.faultMode === 'scripted' ? 'с учебными сигналами' : 'без учебных отказов'}.`;
      const c = result?.context || context;
      $('comparison-context').textContent = c ? `${c.workloadCount} одинаковых заданий за полный прогон · зарядок: ${c.chargerCount} · задания и путь к зарядке ≤${c.admissionCap} одновременно (возврат без задания и стоянка на зарядке не занимают лимит) · парковочных карманов общей схемы: ${c.parkingCapacity} · ${c.faultMode === 'scripted' ? 'фиксированные учебные сигналы для роботов 1–4' : 'без учебных отказов'}.` : 'При запуске фиксируются одна планировка, зарядки, правила движения и полный поток заданий. Число машин меняется отдельно.';
      $('comparison-note').textContent = model ? `Номинальная нагрузка ${num(model.input.demand?.peakPerH)} пал./ч; пиковое окно ${num(model.input.demand?.peakMin)} мин, прогрев ${num(model.input.demand?.warmupMin)} мин. Один seed ${model.input.seed} — одна проверенная нагрузка. Общая схема парковок под верхнюю границу может отличаться от исходной.` : '';
      let message = 'Перебор ещё не запускался.', kind = 'neutral';
      if (modelDirty) message = 'Условия объекта изменены. Сначала пересчитайте сценарий; прежнее сравнение нельзя применять.';
      else if (error) { message = error; kind = 'fail'; }
      else if (settingsDirty) message = 'Настройки поиска изменены. Таблица относится к прежнему перебору; запустите новый.';
      else if (working) { message = 'Сравнение выполняется. Минимум ещё не установлен.'; kind = 'running'; }
      else if (result) {
        if (result.status === 'INVALID') { message = 'Нагрузка кандидатов не совпала. Это сравнение непригодно для выбора парка.'; kind = 'fail'; }
        else if (result.status === 'PARTIAL') {
          message = `${result.stopReason === 'cancelled' ? 'Поиск остановлен.' : 'Исчерпан лимит времени.'} Перебор неполный; минимум не установлен.${result.bestTestedPassingFleet == null ? '' : ` Парк ${result.bestTestedPassingFleet} выполнил критерии среди проверенных.`}`; kind = 'warn';
        } else if (!result.coverage.eligibleFleets.length) message = 'В этом диапазоне сценарий неприменим: учебные сигналы требуют роботов 1–4.';
        else if (result.minimumFleet != null) { message = `Наименьший парк, выполнивший критерии: ${result.minimumFleet}. Проверен диапазон ${Math.max(result.coverage.requestedMin, result.context.eligibleMinFleet)}–${result.coverage.requestedMax} на этой нагрузке и общей схеме. Это не финансовый или глобальный оптимум.`; kind = 'pass'; }
        else { message = `В применимом диапазоне до ${result.coverage.requestedMax} машин парк, выполнивший все критерии, не найден. Причины доступны в проверенных прогонах.`; kind = 'warn'; }
      }
      $('comparison-verdict').textContent = message; $('comparison-verdict').dataset.kind = kind;
      $('comparison-progress-text').textContent = working ? `${completed} / ${total} вариантов завершено${nextFleet ? ` · сейчас парк ${nextFleet}` : ' · подготовка общей нагрузки'}. Лимит поиска — 30 с.` : result ? `Проверено ${result.coverage.completedFleets.length} полных прогонов; неприменимо ${result.coverage.ineligibleFleets.length}; ${num(result.elapsedMs / 1000)} с расчёта.` : 'Перебираем размеры по очереди, без предположения, что больше роботов всегда лучше.';
      for (const run of runs.values()) rowFor(run);
    }
    function fail(message, token) {
      if (token !== generation) return;
      releaseWorker(); working = false; error = message; result = null; onBusy(false); render();
    }
    function start() {
      if (working || externalBusy || modelDirty || !model || !$('comparison-max').reportValidity()) return;
      const maxFleet = Number($('comparison-max').value), faultMode = $('comparison-fault-mode').value;
      if (!Number.isSafeInteger(maxFleet) || maxFleet < 1 || maxFleet > 60) return;
      if (faultMode === 'scripted' && maxFleet < 4) { error = 'Для фиксированного сценария сигналов нужны как минимум 4 робота. Увеличьте границу или выберите режим без отказов.'; render(); return; }
      releaseWorker(); const token = ++generation;
      reference = model; result = null; context = null; error = ''; lastProgress = null; completed = 0; total = maxFleet; nextFleet = null; settingsDirty = false;
      runs.clear(); rows.clear(); $('comparison-rows').replaceChildren();
      const code = $('demo-core-script').textContent + `
        let controller = null;
        self.onmessage = async function(event) {
          if (event.data.type === 'cancel') { controller?.abort(); return; }
          controller = new AbortController();
          try {
            const result = await WarehouseDemoCore.compareWarehouseFleet(event.data.reference, {
              ...event.data.options, signal: controller.signal,
              onProgress: progress => self.postMessage({ type: 'progress', progress })
            });
            self.postMessage({ type: 'result', result });
          } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
        };`;
      try {
        workerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); worker = new Worker(workerUrl);
        worker.onmessage = event => {
          if (token !== generation) return;
          if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
          const data = event.data;
          if (data.type === 'progress') {
            const p = data.progress; lastProgress = p; completed = p.completed; total = p.total; nextFleet = p.nextFleet ?? null;
            if (p.contextSummary) context = p.contextSummary;
            if (p.run) runs.set(p.run.fleet, p.run);
            render();
          } else if (data.type === 'result') {
            result = data.result; context = result.context; runs.clear(); for (const run of result.runs) runs.set(run.fleet, run);
            completed = result.runs.filter(r => r.status !== 'INTERRUPTED').length; nextFleet = null;
            releaseWorker(); working = false; onBusy(false); render();
          } else fail(`Сравнение не завершено: ${data.message}`, token);
        };
        worker.onerror = () => fail('Сравнение остановлено ошибкой фонового расчёта. Повторите запуск или уменьшите диапазон.', token);
        working = true; onBusy(true); render();
        worker.postMessage({ type: 'run', reference, options: { minFleet: 1, maxFleet, faultMode, budgetMs: 30000 } });
      } catch (failure) { fail(`Не удалось запустить фоновое сравнение: ${failure.message}`, token); }
    }
    $('comparison-start').addEventListener('click', start);
    $('comparison-cancel').addEventListener('click', () => {
      if (!working) return;
      worker.postMessage({ type: 'cancel' }); $('comparison-cancel').disabled = true;
      $('comparison-progress-text').textContent = 'Останавливаем расчёт. Полностью проверенные варианты сохранятся.';
    });
    for (const id of ['comparison-max', 'comparison-fault-mode']) $(id).addEventListener('input', () => { settingsDirty = Boolean(result); error = ''; render(); });
    return {
      setModel(next, { preserveComparison = false } = {}) {
        const preserve = preserveComparison && result && next.comparisonOrigin?.contextKey === result.context.contextKey;
        model = next; modelDirty = false;
        if (!preserve) {
          ++generation; releaseWorker(); const wasWorking = working; working = false;
          reference = null; result = null; context = null; error = ''; lastProgress = null; completed = 0; total = 0; nextFleet = null; settingsDirty = false;
          runs.clear(); rows.clear(); $('comparison-rows').replaceChildren();
          $('comparison-max').value = Math.min(60, Math.max(20, next.input.robots.count)); $('comparison-fault-mode').value = 'baseline';
          if (wasWorking) onBusy(false);
        }
        render();
      },
      setDirty(value) { modelDirty = value; if (value && working) worker?.postMessage({ type: 'cancel' }); render(); },
      setExternalBusy(value) { externalBusy = value; render(); },
      snapshot() { return result ? { settingsDirty, modelDirty, result } : null; },
      stats() { return { working, externalBusy, modelDirty, settingsDirty, completed, total, nextFleet, phase: lastProgress?.phase ?? null, status: result?.status ?? null, error }; },
      dispose() { ++generation; releaseWorker(); },
    };
  };
})();
