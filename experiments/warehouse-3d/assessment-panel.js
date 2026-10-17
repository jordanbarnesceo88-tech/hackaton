(function () {
  'use strict';
  const labels = { PASS: 'Пройдено', FAIL: 'Не выполнено', WARN: 'Есть ограничение', NOT_EVALUATED: 'Не проверено', NOT_APPLICABLE: 'Не требуется' };
  const categories = { goal: 'Цель сценария', safety: 'Проверки движения', operation: 'Работа парка', readiness: 'Готовность к внедрению' };
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const time = s => [Math.floor(s / 3600), Math.floor(s % 3600 / 60), Math.floor(s % 60)].map(v => String(v).padStart(2, '0')).join(':');
  window.createAssessmentPanel = function ({ onEvidence }) {
    const host = document.getElementById('assessment-checks');
    const assumptions = document.getElementById('assessment-assumptions');
    const sources = document.getElementById('assessment-sources');
    let last = null;
    return {
      setModel(model) {
        if (last === model) return;
        last = model;
        const assessment = model.assessment;
        host.replaceChildren();
        if (!assessment) { host.append(node('p', 'Оценка этого прогона недоступна.', 'note')); return; }
        const checks = assessment.checks || [];
        document.getElementById('assessment-count').textContent = `Критерии и доказательства · ${checks.length}`;
        for (const [category, title] of Object.entries(categories)) {
          const group = checks.filter(c => c.category === category);
          if (!group.length) continue;
          const section = node('section', null, 'assessment-group');
          section.append(node('h3', title));
          for (const check of group) {
            const item = node('details', null, 'assessment-check'); item.dataset.check = check.id; item.dataset.status = check.status;
            const summary = node('summary');
            summary.append(node('strong', check.label || check.id), node('span', labels[check.status] || check.status, 'assessment-check-state'));
            const values = node('span', null, 'assessment-measure');
            values.append(node('span', `Получено: ${check.measuredText || 'не определено'}`), node('span', `Критерий: ${check.limitText || 'не задан'}`));
            summary.append(values); item.append(summary, node('p', check.why, 'assessment-why'));
            if (check.action) item.append(node('p', check.action, 'assessment-action'));
            const evidence = (check.evidence || []).filter(e => Number.isFinite(e.tS));
            if (evidence.length) {
              const links = node('div', null, 'assessment-evidence');
              for (const e of evidence.slice(0, 3)) {
                const zone = e.zoneId != null ? model.sections?.find(z => z.id === e.zoneId)?.label || e.zoneId : '';
                const name = `${e.robotId != null ? ` · робот ${e.robotId + 1}` : ''}${e.taskId != null ? ` · задание #${e.taskId}` : ''}${zone ? ` · ${zone}` : ''}`;
                const button = node('button', `Кадр ${time(e.tS)}${name}`); button.type = 'button'; button.dataset.evidenceTime = e.tS;
                button.addEventListener('click', () => onEvidence(e)); links.append(button);
              }
              item.append(links);
            }
            section.append(item);
          }
          host.append(section);
        }
        assumptions.replaceChildren(...(model.assumptions || []).map(text => node('li', text)));
        sources.replaceChildren(...(model.sources || []).map(text => node('li', text)));
      },
    };
  };
})();
