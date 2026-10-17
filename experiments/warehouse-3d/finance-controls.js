window.createFinanceConditions = function createFinanceConditions(form) {
  const area = document.createElement('details');
  area.innerHTML = `<summary>Персонал эксплуатации и состав платежей</summary>
    <p class="note">Исходная модель оплачивает отдельный пост на всё время работы склада. Выберите организацию эксплуатации и только дополнительные затраты. Изменение этих условий не меняет поведение роботов.</p>
    <div class="field"><label for="finance-staff-mode">Кто обслуживает парк</label><select id="finance-staff-mode"><option value="legacy">Исходное допущение: выделенный пост</option><option value="dedicated">Выделенный персонал с другой ставкой</option><option value="shared-existing">Существующий сотрудник: только доплата</option><option value="integrator">Диспетчеризация интегратором</option></select></div>
    <div data-staff="dedicated" hidden><div class="field"><label for="finance-staff-salary">Оклад до начислений, ₽/мес</label><input id="finance-staff-salary" type="number" min="0.01" max="10000000" step="any"></div><div class="field"><label for="finance-staff-fund">Годовой фонд часов одной ставки</label><input id="finance-staff-fund" type="number" min="1" max="8784" step="any"></div></div>
    <div data-staff="shared-existing" hidden><div class="field"><label for="finance-staff-hours">Дополнительно оплачиваемые часы всего парка за год</label><input id="finance-staff-hours" type="number" min="0" max="10000000" step="any"></div><div class="field"><label for="finance-staff-hourly">Доплата до начислений, ₽/ч</label><input id="finance-staff-hourly" type="number" min="0" max="10000000" step="any"></div><p class="note">Если доплаты нет, введите 0 и обоснуйте, кто обслуживает парк в рамках текущих обязанностей. Неизвестные расходы не равны нулю.</p></div>
    <div data-staff-payroll hidden class="field"><label for="finance-staff-payroll">Множитель начислений на ФОТ</label><input id="finance-staff-payroll" type="number" min="1" max="3" step="any"></div>
    <div data-staff="integrator" hidden><div class="field"><label for="finance-staff-billing">Оплата диспетчеризации</label><select id="finance-staff-billing"><option value="separate">Отдельная годовая плата</option><option value="included-in-service">Включена в сервис / RaaS</option></select></div><div class="field" data-staff-fee><label for="finance-staff-fee">Плата за весь парк, ₽/год</label><input id="finance-staff-fee" type="number" min="0" max="1000000000000" step="any"></div><p class="note">Техническое обслуживание само по себе не включает диспетчеризацию. Для включения нужно явное основание.</p></div>
    <div class="field" data-staff-reason hidden><label for="finance-staff-reason">Источник / обоснование расходов эксплуатации</label><textarea id="finance-staff-reason" rows="2" maxlength="1000"></textarea></div>
    <label class="note"><input id="finance-package-enabled" type="checkbox">Уточнить комплектацию покупки</label>
    <div data-finance-package hidden><p class="note">Состав пакета задаётся только для покупки. Из обзорной статьи или цены робота он автоматически не выводится. АКБ и расходные материалы остаются отдельными.</p><label class="note"><input id="finance-package-software" type="checkbox">ПО включено в интеграцию</label><label class="note"><input id="finance-package-repair" type="checkbox">Ремонт включён в сервис</label><div class="field"><label for="finance-package-chargers">Станций уже включено в оборудование</label><input id="finance-package-chargers" type="number" min="0" max="2000" step="1" value="0"></div><div class="field"><label for="finance-package-reason">Источник / основание комплектации</label><textarea id="finance-package-reason" rows="2" maxlength="1000"></textarea></div></div>`;
  form.insertBefore(area, form.querySelector('#finance-accepted').closest('label'));
  const get = id => form.querySelector(`#${id}`);
  const mode = get('finance-staff-mode'), billing = get('finance-staff-billing'), enabled = get('finance-package-enabled');
  function visibility() {
    area.querySelectorAll('[data-staff]').forEach(node => { node.hidden = node.dataset.staff !== mode.value; });
    area.querySelector('[data-staff-payroll]').hidden = !['dedicated', 'shared-existing'].includes(mode.value);
    area.querySelector('[data-staff-fee]').hidden = billing.value !== 'separate';
    area.querySelector('[data-staff-reason]').hidden = mode.value === 'legacy';
    area.querySelector('[data-finance-package]').hidden = !enabled.checked;
    area.querySelectorAll('input,textarea').forEach(node => {
      if (node.type === 'checkbox') return;
      node.disabled = !!node.closest('[hidden]');
      node.required = !node.disabled;
    });
  }
  [mode, billing, enabled].forEach(node => node.addEventListener('change', visibility));
  function write(options, chargers) {
    const staff = options?.operationsStaffing, pkg = options?.costPackage;
    mode.value = staff?.mode ?? 'legacy'; billing.value = staff?.billing ?? 'separate';
    for (const [id, value] of Object.entries({ 'finance-staff-salary': staff?.grossSalaryRubMonth ?? 120000, 'finance-staff-fund': staff?.annualHoursPerFte ?? 1973, 'finance-staff-hours': staff?.incrementalHoursYear ?? '', 'finance-staff-hourly': staff?.grossHourlyRub ?? '', 'finance-staff-payroll': staff?.payrollMultiplier ?? 1.302, 'finance-staff-fee': staff?.annualFeeRub ?? '', 'finance-staff-reason': staff?.reason ?? '', 'finance-package-chargers': pkg?.includedChargers ?? 0, 'finance-package-reason': pkg?.reason ?? '' })) get(id).value = value;
    enabled.checked = !!pkg; get('finance-package-software').checked = pkg?.softwareIncludedInIntegration ?? false; get('finance-package-repair').checked = pkg?.repairsIncludedInService ?? false; get('finance-package-chargers').max = chargers;
    visibility();
  }
  function read() {
    const num = id => { if (!get(id).value.trim()) throw new Error('Заполните дополнительные расходы; неизвестное не равно нулю'); return Number(get(id).value); };
    const reason = get('finance-staff-reason').value.trim();
    const operationsStaffing = mode.value === 'legacy' ? undefined : mode.value === 'dedicated'
      ? { mode: mode.value, grossSalaryRubMonth: num('finance-staff-salary'), payrollMultiplier: num('finance-staff-payroll'), annualHoursPerFte: num('finance-staff-fund'), reason }
      : mode.value === 'shared-existing' ? { mode: mode.value, incrementalHoursYear: num('finance-staff-hours'), grossHourlyRub: num('finance-staff-hourly'), payrollMultiplier: num('finance-staff-payroll'), reason }
        : billing.value === 'separate' ? { mode: 'integrator', billing: billing.value, annualFeeRub: num('finance-staff-fee'), reason } : { mode: 'integrator', billing: billing.value, reason };
    const costPackage = enabled.checked ? { softwareIncludedInIntegration: get('finance-package-software').checked, repairsIncludedInService: get('finance-package-repair').checked, includedChargers: num('finance-package-chargers'), reason: get('finance-package-reason').value.trim() } : undefined;
    return { ...(operationsStaffing ? { operationsStaffing } : {}), ...(costPackage ? { costPackage } : {}) };
  }
  visibility();
  return { write, read };
};
