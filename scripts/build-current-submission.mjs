/* Reproducible current submission. Run `node scripts/build-current-submission.mjs capture`
 * against the locally running complete platform, then `... build` and `... manifest`.
 * No credentials, cookies, environment files or private project data are exported. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/submission/current');
const BASE = process.env.SUBMISSION_BASE_URL || 'http://localhost:3085';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt = (value, digits = 2) => value == null ? '-' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
const money = value => value == null ? '-' : `${fmt(value / 1e6)} млн ₽`;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));
const write = (name, content) => fs.writeFileSync(path.join(OUT, name), content);
const table = (headers, rows) => `<table><thead><tr>${headers.map(v=>`<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const para = text => `<p>${esc(text)}</p>`;
const list = values => `<ul>${values.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`;
const section = (n, title, html) => `<section class="chapter"><div class="kicker">РУКОВОДСТВО / ${n}</div><h1>${esc(title)}</h1>${html}</section>`;

async function capture() {
  if (!process.env.DEMO_USER_PASSWORD) throw new Error('Set DEMO_USER_PASSWORD for the authorized local demo account');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(20_000);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `submission-current-${crypto.randomUUID()}` });
    const receiptPromise = page.waitForResponse(response => response.url().endsWith('/api/v1/demo-calculation') && response.request().method() === 'POST', { timeout: 120_000 });
    await page.goto(`${BASE}/demo?example=steady-flow`, { waitUntil: 'domcontentloaded' });
    const response = await receiptPromise;
    if (response.status() !== 200) throw new Error(`Demo calculation HTTP ${response.status()}`);
    const submitted = response.request().postDataJSON();
    const publicReceipt = await response.json();
    write('steady-flow-receipt.json', JSON.stringify(publicReceipt, null, 2));
    for (const key of ['peak-overload', 'retained-staff']) {
      const pending=page.waitForResponse(response=>response.url().endsWith('/api/v1/demo-calculation')&&response.request().method()==='POST',{timeout:120_000});
      await page.goto(`${BASE}/demo?example=${key}`,{waitUntil:'domcontentloaded'});
      const actual=await pending;
      if(actual.status()!==200) throw new Error(`${key} calculation HTTP ${actual.status()}`);
      write(`${key}-receipt.json`,JSON.stringify(await actual.json(),null,2));
    }
    await page.goto(`${BASE}/login`);
    await page.locator('#email').fill('demo@demo.local');
    await page.locator('#password').fill(process.env.DEMO_USER_PASSWORD);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/projects');
    const result = await page.request.post(`${BASE}/api/v1/calculation-jobs`, {
      data: { operation: 'CREATE', name: 'Сдаточный пример - полный цикл стеллажа N6 C2', facility: 'warehouse', params: submitted.params, scenarios: submitted.scenarios },
      headers: { 'Idempotency-Key': crypto.randomUUID(), Origin: BASE }, timeout: 120_000,
    });
    if (result.status() !== 202) throw new Error(`CREATE HTTP ${result.status()}: ${await result.text()}`);
    const id = (await result.json()).job.id;
    let job;
    for (let i = 0; i < 120; i++) {
      job = (await (await page.request.get(`${BASE}/api/v1/calculation-jobs/${id}`)).json()).job;
      if (job.status === 'SUCCEEDED') break;
      if (['FAILED', 'CANCELLED'].includes(job.status)) throw new Error(`Job ${job.status}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (job.status !== 'SUCCEEDED') throw new Error('CREATE did not finish within 120 s');
    const completed = await (await page.request.get(`${BASE}/api/v1/calculation-jobs/${id}/result`)).json();
    const projectId = completed.job.projectId;
    const rawProject = await (await page.request.get(`${BASE}/api/v1/projects/${projectId}`)).json();
    const results = completed.results;
    const purchase = results.scenarios.find(s => s.key === 'purchase');
    if (purchase?.spatialEvidence?.assessment.status !== 'OK' || purchase.spatialEvidence.simModelVersion !== 'warehouse-dense-underlift-1.7.2') throw new Error('Qualified current source not established');
    const financial = results.results.find(r => r.key === 'purchase');
    if (!(financial.npvRub > 0) || financial.items[0].n !== 6 || financial.items[0].chargers !== 2) throw new Error('Unexpected qualified financial source');
    write('calculation-source.json', JSON.stringify({ capturedAt: new Date().toISOString(), baseUrl: BASE, project: { id: projectId, name: rawProject.name, revision: rawProject.revision }, operation: { id, kind: 'CREATE', status: job.status, publication: completed.job.publicationState, engineRelease:completed.job.engineRelease }, submitted: { facility: 'warehouse', params: submitted.params, scenarios: submitted.scenarios }, results }, null, 2));
    for (const extension of ['csv', 'xlsx']) {
      const exported = await page.request.get(`${BASE}/projects/${projectId}/export.${extension}`, { timeout: 60_000 });
      if (exported.status() !== 200) throw new Error(`Export ${extension} HTTP ${exported.status()}`);
      write(`sample-report.${extension}`, await exported.body());
    }
    await page.goto(`${BASE}/projects/${projectId}/report?scenario=purchase`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Покупка — Ronavi H1500', exact: true }).first().waitFor();
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, 'sample-report.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });
    await page.screenshot({ path: path.join(OUT, 'sample-report.png') });
    console.log(JSON.stringify({ projectId, jobId: id, assessment: purchase.spatialEvidence.assessment.status, version: purchase.spatialEvidence.simModelVersion, npvRub: financial.npvRub, summary: purchase.spatialEvidence.summary }));
  } finally { await browser.close(); }
}

async function report() {
  if (!process.env.DEMO_USER_PASSWORD) throw new Error('Set DEMO_USER_PASSWORD for the authorized local demo account');
  const source = read('calculation-source.json');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width:1440, height:960 } });
    await page.goto(`${BASE}/login`);
    await page.locator('#email').fill('demo@demo.local');
    await page.locator('#password').fill(process.env.DEMO_USER_PASSWORD);
    await page.getByRole('button', { name:'Войти', exact:true }).click();
    await page.waitForURL(url=>url.pathname==='/projects');
    await page.goto(`${BASE}/projects/${source.project.id}/report?scenario=purchase`, { waitUntil:'networkidle' });
    await page.getByRole('heading', { name:'Покупка — Ronavi H1500', exact:true }).first().waitFor();
    await page.emulateMedia({ media:'print' });
    await page.pdf({ path:path.join(OUT,'sample-report.pdf'), format:'A4', printBackground:true, preferCSSPageSize:true });
    await page.emulateMedia({ media:'screen' });
    await page.screenshot({ path:path.join(OUT,'sample-report.png') });
    console.log(JSON.stringify({ projectId:source.project.id, report:'printed' }));
  } finally { await browser.close(); }
}

async function refresh() {
  if (!process.env.DEMO_USER_PASSWORD) throw new Error('Set DEMO_USER_PASSWORD for the authorized local demo account');
  const source = read('calculation-source.json');
  const browser = await chromium.launch({ headless:true });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`);
    await page.locator('#email').fill('demo@demo.local');
    await page.locator('#password').fill(process.env.DEMO_USER_PASSWORD);
    await page.getByRole('button', { name:'Войти', exact:true }).click();
    await page.waitForURL(url=>url.pathname==='/projects');
    const before = await (await page.request.get(`${BASE}/api/v1/projects/${source.project.id}`)).json();
    const response = await page.request.post(`${BASE}/api/v1/calculation-jobs`, {
      data:{ operation:'SAVE', projectId:source.project.id, expectedRevision:before.revision, name:source.project.name,
        params:source.submitted.params, scenarios:source.submitted.scenarios },
      headers:{ 'Idempotency-Key':crypto.randomUUID(), Origin:BASE },
    });
    if (response.status() !== 202) throw new Error(`SAVE HTTP ${response.status()}: ${await response.text()}`);
    const id=(await response.json()).job.id;
    let job;
    for(let i=0;i<120;i++) {
      job=(await(await page.request.get(`${BASE}/api/v1/calculation-jobs/${id}`)).json()).job;
      if(job.status==='SUCCEEDED') break;
      if(['FAILED','CANCELLED'].includes(job.status)) throw new Error(`SAVE ${job.status}`);
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if(job.status!=='SUCCEEDED') throw new Error('SAVE did not finish');
    const completed=await(await page.request.get(`${BASE}/api/v1/calculation-jobs/${id}/result`)).json();
    if(completed.job.publicationState!=='PUBLISHED') throw new Error('SAVE not published');
    const after=await(await page.request.get(`${BASE}/api/v1/projects/${source.project.id}`)).json();
    if(after.revision!==before.revision+1) throw new Error('SAVE revision did not advance exactly once');
    const prev=source.results.scenarios.find(s=>s.key==='purchase').spatialEvidence;
    const next=completed.results.scenarios.find(s=>s.key==='purchase').spatialEvidence;
    if(JSON.stringify(prev.summary)!==JSON.stringify(next.summary) || next.assessment.status!=='OK') throw new Error('Physical source unexpectedly changed');
    const previousFinancial=source.results.results.find(r=>r.key==='purchase');
    const currentFinancial=completed.results.results.find(r=>r.key==='purchase');
    if(previousFinancial.npvRub!==currentFinancial.npvRub) throw new Error('Financial source unexpectedly changed');
    source.previousCapture={ capturedAt:source.capturedAt, operation:source.operation, revision:source.project.revision };
    source.capturedAt=new Date().toISOString();
    source.project.revision=after.revision;
    source.operation={ id, kind:'SAVE', status:job.status, publication:completed.job.publicationState, engineRelease:completed.job.engineRelease };
    source.results=completed.results;
    write('calculation-source.json',JSON.stringify(source,null,2));
    for(const extension of ['csv','xlsx']) {
      const exported=await page.request.get(`${BASE}/projects/${source.project.id}/export.${extension}`);
      if(exported.status()!==200) throw new Error(`Export ${extension} failed`);
      write(`sample-report.${extension}`,await exported.body());
    }
    await page.goto(`${BASE}/projects/${source.project.id}/report?scenario=purchase`, {waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Покупка — Ronavi H1500',exact:true}).first().waitFor();
    await page.emulateMedia({media:'print'});
    await page.pdf({path:path.join(OUT,'sample-report.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
    console.log(JSON.stringify({project:source.project,operation:source.operation,physicsUnchanged:true,npvUnchanged:true}));
  } finally { await browser.close(); }
}

async function visuals() {
  if (!process.env.DEMO_USER_PASSWORD) throw new Error('Set DEMO_USER_PASSWORD for the authorized local demo account');
  const source=read('calculation-source.json');
  fs.mkdirSync(path.join(OUT,'assets'),{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1050},reducedMotion:'reduce'});
    page.setDefaultTimeout(30_000);
    await page.goto(`${BASE}/login`);
    await page.locator('#email').fill('demo@demo.local');
    await page.locator('#password').fill(process.env.DEMO_USER_PASSWORD);
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/projects');
    await page.goto(`${BASE}/projects/${source.project.id}?edit=1#simulation`);
    await page.getByRole('navigation',{name:'Шаги расчёта'}).getByRole('link',{name:/^7 /}).click();
    const popup=page.waitForEvent('popup');
    await page.getByRole('button',{name:'Проверить этот вариант в 3D ↗',exact:true}).click();
    const child=await popup;
    await child.setViewportSize({width:1600,height:1050});
    await child.waitForFunction(()=>window.warehouseDemo?.snapshot()?.projectOrigin&&!window.warehouseDemo.snapshot().busy,null,{timeout:180_000});
    await child.locator('#timeline').evaluate(input=>{input.value='3000';input.dispatchEvent(new Event('change',{bubbles:true}));});
    await child.waitForFunction(()=>{const s=window.warehouseDemo.snapshot();return !s.busy&&Math.abs(s.frame.tS-3000)<1;},null,{timeout:120_000});
    const snapshot=await child.evaluate(()=>window.warehouseDemo.snapshot());
    if(snapshot.input.robots.count!==6 || snapshot.input.layout.chargers!==2 || snapshot.assessment.status!=='OK') throw new Error('Visual proof is not the qualified N6/C2 case');
    await child.locator('#stage').scrollIntoViewIfNeeded();
    await child.locator('#stage').screenshot({path:path.join(OUT,'assets/warehouse-current.png')});
    const robot=snapshot.frame.robots.find(r=>r.loaded)||snapshot.frame.robots[0];
    await child.locator(`#fleet-rows tr[data-robot-id="${robot.id}"] button`).click();
    await child.locator('dialog[open]').waitFor();
    await child.locator('#rd-canvas canvas').waitFor();
    await child.waitForTimeout(800);
    await child.locator('dialog[open]').screenshot({path:path.join(OUT,'assets/robot-current.png')});
    write('visual-source.json',JSON.stringify({capturedAt:new Date().toISOString(),project:source.project.id,simulationTimeS:snapshot.frame.tS,fleet:snapshot.input.robots.count,chargers:snapshot.input.layout.chargers,assessment:snapshot.assessment,summary:snapshot.summary,projectOrigin:snapshot.projectOrigin,robotId:robot.id},null,2));
    console.log(JSON.stringify({visuals:'captured',fleet:6,chargers:2,status:snapshot.assessment.status,robotId:robot.id}));
  } finally {await browser.close();}
}

function facts() {
  const source = read('calculation-source.json');
  return { source, examples: ['steady-flow', 'peak-overload', 'retained-staff'].map(id => {
    const receipt = read(`${id}-receipt.json`), results = receipt.results;
    const spec = results.scenarios.find(s => s.key === 'purchase');
    const financial = results.results.find(r => r.key === 'purchase');
    return { id, results, spec, financial, evidence: spec.spatialEvidence };
  }) };
}

function docs(data) {
  const { source, examples } = data, qualified = examples[0], q = qualified.evidence.summary, f = qualified.financial;
  const verification=read('verification-review.json');
  const exampleRows = examples.map(ex => [ex.id, `${ex.financial.items[0].n} / ${ex.financial.items[0].chargers}`, ex.evidence.assessment.status, `${fmt(ex.evidence.summary.achievedPerH)} / ${fmt(ex.evidence.summary.requiredPerH)}`, `${ex.evidence.summary.queueEnd} / ${fmt(ex.evidence.summary.waitP95Min)}`, money(ex.financial.npvRub)]);
  const proof = table(['Пример','N / C','Физика','Факт / цель, пал./ч','Очередь / p95, мин','NPV покупки'], exampleRows);
  const input = source.results.paramsUsed;
  const css = `*{box-sizing:border-box}body{margin:0;color:#142d32;font-family:Arial,sans-serif;background:white}h1,h2,h3{letter-spacing:-.025em}h1{font-size:27pt;line-height:1.08;margin:10mm 0 9mm}h2{font-size:16pt;margin:8mm 0 4mm}p,li{font-size:11pt;line-height:1.48}p{margin:0 0 4mm}li{margin:2.5mm 0}ul{padding-left:6mm}table{width:100%;border-collapse:collapse;margin:6mm 0;font-size:9pt;line-height:1.4;table-layout:fixed}th{background:#dfe9e6;text-align:left}td,th{padding:3mm;border-bottom:1px solid #b6c9c6;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}.kicker{font:9pt Consolas,monospace;letter-spacing:.1em;color:#17696c;border-top:3px solid #17696c;padding-top:4mm}.chapter{break-before:page}.chapter:first-child{break-before:auto}.note{border-left:3px solid #17696c;padding:4mm;background:#edf3ef}.metric{font-size:30pt;font-weight:bold;color:#17696c}code,pre{font:9pt/1.5 Consolas,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#edf1ef;padding:5mm}small{font-size:9pt;line-height:1.4;color:#516d72}@page{size:A4;margin:16mm 16mm 18mm}`;
  const full = [
    section('00','Платформа оценки роботизации',para('От исходных данных объекта до проверяемого решения и плана пилота.')+para('Основной процесс: складская перевозка паллет с поддомкрачивающим роботом и замкнутым циклом мобильного стеллажа. Дополнительное демонстрационное направление - уборка.')+`<div class="note"><b>18 октября 2026</b><p>tz-1.0.5 / sim-1.1.0 / warehouse-dense-underlift-1.7.2</p></div>`+para('Этот документ сопровождает текущий локальный выпуск. Результаты учебные: они относятся к указанным данным, геометрии, seed и политике диспетчеризации. Статус модели не заменяет обследование и натурный пилот.')),
    section('01','Для кого и какой результат',para('Руководитель получает сравнение покупки, RaaS и текущего процесса, стоимость и ограничения внедрения. Инженер проверяет планировку, цикл, зарядку, очереди и телеметрию. Интегратор получает план обследования и измерительного пилота.')+table(['Область','Текущий объём'],[['Склад','Полный путь: параметры, подбор, деньги, физическая проверка, сохранение и экспорт'],['Аэропорт и медучреждение','Выбор типа объекта, параметры, каталог решений. Экономика и динамическая имитация обозначены как прототип'],['Уборка','Отдельное дополнительное 3D-демо. Не заменяет основную складскую проверку']])+list(['1. Выбрать объект и указать исходные данные с источниками.','2. Проверить применимость и причины исключения продуктов.','3. Сравнить состав оборудования, финансы и физическую выполнимость.','4. Настроить план пилота, сохранить проект и передать отчёт.'])),
    section('02','Каталог, данные и подбор',para('Каталог организован по отрасли, объекту, процессу и типу решения. Поиск, фильтры, сортировка и сравнение помогают отобрать продукты. Карточка хранит происхождение, источники и качество характеристик. Неизвестные ТТХ и ставки не превращаются в ноль.')+para('Подбор сначала применяет жёсткие технические ограничения. Вклад факторов объяснимого score доступен отдельно. Ручное добавление требует причины и оставляет предупреждение. Балл не подтверждает пригодность на конкретном объекте.')+table(['Вход','Как проверяется'],[['Параметры объекта','Единицы, диапазоны, обязательность, источники, предупреждения качества'],['Excel / CSV','Предпросмотр, сопоставление полей и применение; максимум файла 950 000 байт'],['Схема','Планировка и граф сохраняются с расчётом; нативный DWG/AutoCAD пока не входит'],['Продукт','Применимость процесса, масса, габариты, ограничения и отсутствующие характеристики']])+para('Карточка поддерживаемого продукта передаёт выбранную модель в покупку и RaaS. Неизвестный или неприменимый продукт получает объяснение, без скрытой подмены роботом по умолчанию.')),
    section('03','Деньги и физика отвечают на разные вопросы',para('Финансовая модель считает CAPEX, OPEX, денежный эффект, ROI, NPV, TCO и окупаемость. Физическая проверка отвечает, обработает ли этот парк заданную нагрузку на этом плане. Положительный NPV не снимает ограничение потока.')+table(['Показатель','Смысл'],[['NPV','-CAPEX плюс дисконтированные чистые годовые потоки и допустимая остаточная стоимость'],['ROI','Накопленный чистый эффект за вычетом инвестиций относительно инвестиций'],['Окупаемость','Время возврата инвестиций; если возврат не достигается, это показано явно'],['TCO','Совокупные затраты минимум за 5 лет; замены оборудования и АКБ учитываются отдельно']])+para('Высвобождение труда и экономия фонда оплаты труда разделены. cashRealizationShare определяет, какая часть высвобождения превращается в денежную экономию. Если сотрудники остаются, увеличение свободного времени само по себе не снижает ФОТ.')+para('Годовой охват нагрузки задаётся отдельно и ограничен расчётной мощностью. Часовой прогон не превращается автоматически в годовую экономию. Кредит, налог на прибыль, инфляция, дополнительный доход и предотвращённые потери базовой моделью не оцениваются.')),
    section('04','Покупка, услуга и допущения',para('Покупка включает состав оборудования, комплектность, внедрение и эксплуатационные расходы. Пакеты учитывают включённые ПО, ремонт и зарядки без двойной оплаты. Оценки не равны коммерческому предложению.')+para('RaaS моделируется договором на 12 месяцев с ежегодным продлением, фиксированной месячной ставкой и без выкупа. Оборудование, зарядки, ПО, сервис, ремонт, расходники и АКБ приняты включёнными; интеграция и обучение отдельно. Эти условия требуют проверки договором.')+para('Чистая остаточная стоимость по умолчанию 0. Ручная оценка учитывается один раз в конце периода TCO; входит в NPV только если горизонт NPV достигает этой даты. Она не увеличивает операционный эффект.')+para('Каталожные цены приняты с НДС. Логистика полного внедрения отдельно не подтверждена и относится к сметному резерву CAPEX; в пилоте доставка выделена отдельной статьёй с источником либо статусом неизвестной суммы.')+para('Срок службы, производительность на объекте, местный сервис, стоимость логистики и подключение лифтов/доков должны уточняться до закупки. Диапазоны чувствительности помогают увидеть, какие допущения меняют решение.')),
    section('05','Полный транспортный цикл',para('Процесс closed-pod-1 связывает экономику и одну каноническую пространственную сводку. Робот подаёт носитель, заезжает под стеллаж, поднимает, перевозит, устанавливает и выезжает; после разгрузки возвращает пустой носитель. Внутренние подачи и возвраты расходуют время и энергию, но не добавляют клиентских перевозок.')+table(['Модель','Объём'],[['closed-pod-1','Поддомкрачивающий робот; плотные мобильные стеллажи; два несущих и порожние перегоны; подхваты, установки и безопасный выезд'],['single-leg-pallet-1','Вилочный робот или тягач; отдельная аналитика одиночной паллетной перевозки без 3D-подтверждения подхвата стеллажа']])+para('Учебный стеллаж: 1,4 × 1,0 × 2,2 м, пять ярусов; робот визуально реконструирован по фотографиям. Плотная раскладка, проходы, препятствия и граф учитываются при движении. Это параметрическая реконструкция с допущениями, а не подтверждённая CAD-модель производителя.')+para('Прямой отход задним ходом сохраняет ориентацию носителя до участка, где разрешён разворот. Проверки геометрических зазоров и конфликтов траекторий сохраняются; роботы не получают разрешение проходить друг через друга. Люди, тормозной путь и сертификация промышленной безопасности не моделируются.')),
    section('06','Как читать результат имитации',table(['Статус','Значение'],[['OK','Все объявленные критерии выполнены для этого входа, seed, окна и версии'],['PARTIAL','Прогон завершён, но есть измеренное ограничение потока, очереди, ожидания или другого критерия'],['FAIL','Нарушение проверяемого условия модели, в том числе безопасности'],['NOT_EVALUATED','Достаточной завершённой оценки нет; отсутствующее измерение не равно нулю']])+para('Начало обработки клиентской заявки включает назначенную внутреннюю подачу носителя для этой заявки. Очередь и p95 измеряют ожидание до начала обработки. Это не завершённая доставка: выходной поток считает только завершённые внешние перевозки.')+para('Отчёт показывает достижение нагрузки, очередь, p95, безопасность, энергию и восстановление после инцидентов. Вердикт не строится только на доле начатых заданий. На карте доступны роботы, носители, секции, зарядки, маршруты и инциденты; по клику - модель и детали робота, внизу - история заданий и состояний.')+para('Скорости ×1, ×5, ×10, ×50 и ×500 ускоряют воспроизведение, а не физические скорости. Ретроспектива показывает состояние выбранного момента, включая полный и пустой носитель. Один удачный seed не доказывает глобальный оптимум или натурную мощность объекта.')),
    section('07','Три воспроизводимых примера',proof+para(`Квалифицированный пример: ${fmt(q.achievedPerH)} пал./ч при цели ${fmt(q.requiredPerH)}, очередь ${q.queueEnd}, p95 ${fmt(q.waitP95Min)} мин. N6/C2. NPV покупки ${money(f.npvRub)}.`)+para(`Вход: активная площадь ${fmt(input.activeAreaM2,0)} м², вход/выход ${input.inboundPalletsPerDay}/${input.outboundPalletsPerDay} паллет в день, ${input.forkliftOperatorsCount} сотрудников, зарплата ${fmt(input.forkliftSalaryRubMonth,0)} ₽/мес, пиковый коэффициент ${input.peakFactor}. Денежная реализация высвобождения труда: steady-flow и peak-overload - 100%, retained-staff - 0%. Это явные учебные допущения, а не данные заказчика.`)+para('steady-flow доказывает существование подходящего модельного варианта. peak-overload сохраняет удвоенную нагрузку и честно показывает ограничение. retained-staff сохраняет физическую работу, но убирает денежную экономию ФОТ. Прежний N5/C2 остаётся контрпримером: положительный NPV не делает недостаточный поток подходящим.')+para('Исходники трёх результатов включены в этот комплект. Квалифицированный образец отчёта получен из реально созданного worker-проекта; PDF/CSV/XLSX относятся к одному сохранённому результату.')),
    section('08','От расчёта к пилоту',para('Следующий шаг зависит от найденного ограничения. Для физически и финансово подходящего сценария готовится измерительный пилот. При нехватке потока сначала меняют конфигурацию или процесс и повторяют проверку; весь поток небольшому тестовому парку не обещается.')+table(['План','Что фиксируется'],[['Участок и состав','Роботы, зарядки, длительность, покупка или услуга'],['Подготовка','План, проходы, покрытия, сеть, доки, лифты, электропитание, базовый процесс'],['Смета','Оборудование, зарядки, доставка, интеграция, подготовка, обучение и другие статьи с источниками'],['Критерии','Поток участка, p95 ожидания, ручные вмешательства, правила остановки'],['Результат','Сопоставление измерений с базой и решение о корректировке/масштабировании']])+para('Неизвестные суммы остаются неизвестными. Смета пилота не масштабирует автоматически мощность полного парка на один-два робота. Пилот имеет собственный состав и бюджет.')+para('Реальный браузерный тест пилота на пространственной версии 1.7.1 проверил шесть статей, источники, критерии, CALCULATE без публикации, SAVE, повторное открытие и численные CSV/XLSX: известная часть 2 745 812 ₽, резерв 12%, итог 3 075 309,44 ₽. Эта проверка относится к тому тестовому входу и версии; новый квалифицированный образец не выдаётся за повтор этого пилотного теста.')),
    section('09','Сервер, очередь и целостность',para('Next.js / React / TypeScript, Prisma и PostgreSQL. Чистый расчётный движок обслуживает интерфейс, API и отдельный Node.js worker. БД хранит принятые входы, снимки справочников, очередь и завершённые результаты.')+table(['Операция','Поведение'],[['CREATE','Создать проект после успешного серверного расчёта'],['CALCULATE','Посчитать текущий черновик; не менять опубликованные params/results/revision'],['SAVE','Рассчитать и опубликовать при совпадении редакции проекта'],['RECALCULATE','Явно обновить существующий проект по актуальным принятым справочникам']])+para('Принятое фоновое задание переживает закрытие вкладки. Есть история, этапы, отмена и восстановление lease. Поздний SAVE сохраняется отдельно как STALE и не переписывает новую редакцию. Публикация проверяет отмену, lease и revision в одной транзакции.')+para('Revision/CAS защищает от потери правок между вкладками. Новые локальные правки не затираются пришедшим ответом на предыдущий ввод. Сервер сам повторяет физический расчёт; присланный клиентом OK не является достаточным подтверждением.')+para('Архив открывается из сохранённого снимка без нового расчёта. Историческая пространственная версия сохраняет прежний статус и показатели и явно не выдаётся за подтверждение текущего контроллера. Копирование позволяет работать дальше, сохраняя исходный архив.')),
    section('10','Интерфейсы и администрирование',table(['Маршрут','Назначение'],[['/demo','Текущий гостевой расчёт и три учебных примера'],['/projects','Собственные проекты, редактор и сохранённые архивы'],['/calculation-jobs','История фоновых операций, результат и отмена'],['/demo/warehouse; /demo/cleaning','Основной пространственный и дополнительный демонстрационные сценарии'],['/catalog; /methodology/tz','Каталог, источники и методика'],['/admin','Каталог, характеристики, нормы, параметры, обновление и журнал'],['/api-docs','Описание API/OpenAPI']])+para('Авторизованный расчёт использует POST /api/v1/calculation-jobs. Гостевой POST /api/v1/demo-calculation считает актуальный ввод внутри HTTP-запроса без создания проекта или долговременной очереди. Закрытие гостевой вкладки не имеет гарантий продолжения фонового задания.')+para('Есть импорт проектов, каталога и нормативов. WMS/ERP/1С и государственные интеграции описаны как направления, а не как работающие подключения. Доступ к собственным проектам, архивам и отчётам проверяется по владельцу; административные операции требуют соответствующей роли.')),
    section('11','Воспроизведение и ограничения',`<h2>Docker</h2><pre>docker compose up --build\n# http://localhost:3000\n# GET /api/health</pre>`+para('Compose поднимает PostgreSQL, миграции, сев, приложение и worker. Первоначальная сборка требует сеть. APP_PORT и DB_PORT задают порты. Для внешнего контура нужны собственные секреты и HTTPS; демонстрационные учётные данные из README предназначены для локального показа.')+`<h2>Локальный Node.js и PostgreSQL</h2><pre>npm ci\nnpx prisma migrate deploy\nnpm run db:seed\nnpm run build\nnpm start\n# второй терминал с тем же окружением:\nnpm run worker</pre>`+para('Node.js 20.19+ в ветке 20, 22.12+ в ветке 22 либо 24+; PostgreSQL 16+. Создать .env по .env.example. App и worker должны иметь одинаковый fingerprint расчётного движка. После правки расчётного кода пересобрать и перезапустить оба.')+para('Вход API ограничен 4 МиБ JSON UTF-8. Очередь допускает до двух действующих lease, двух активных операций владельца и ста ожидающих. Это политика допуска, а не доказательство неограниченной производительности. Полный расчёт имеет абсолютный бюджет 60 с, пространственная часть - до 45 с внутри него.')+para('Не входят: нативный DWG/AutoCAD, полный мировой каталог и расписание парсинга, натурная калибровка, промышленная сертификация безопасности, утверждённый контур персональных данных и работающие промышленные/государственные интеграции.')),
    section('12','Проверки и границы доказательств',table(['Проверка','Подтверждение и граница'],[['Unit','173 файла, 1903 теста PASS; отдельный журнал текущего исходного среза'],['Типы, lint, diff','Ошибок не выявлено в выполненных проверках исходников'],['База данных',verification.database.statement],['Браузер','Реальные CREATE/CALCULATE/SAVE/reopen NPV parity/отчёт/copy/delete; отмена/STALE/новые правки; admin и публичные маршруты проверены отдельными прогонами'],['Пилот','Независимая числовая сверка и сохранение/экспорт на 1.7.1; ограничение версии указано отдельно'],['Нагрузка','Исторические 50 пользователей проверяли чтение/формы прежнего выпуска; это не тест 50 одновременных вычислений новой очереди']])+para('Этот набор доказательств не означает «все требования ТЗ закрыты» и не является промышленным SLA. Внешний стенд и публикация исходников не объявляются обновлёнными локальным тестом. Непроверенные сочетания ввода, иные seed и неизвестные свойства оборудования требуют отдельной проверки.')+para('Источники комплекта: текущие README, docs/CALCULATION_JOBS.md, docs/LIMITATIONS.md, /methodology/tz; расчётные версии в исходниках; calculation-source.json и три реальных серверных receipt. SHA256 файлов и точные границы приёмки перечислены в release-manifest.json.')),
  ].join('');
  const asset=name=>`data:image/png;base64,${fs.readFileSync(path.join(OUT,'assets',name)).toString('base64')}`;
  const visual=(name,caption)=>`<figure><img src="${asset(name)}"><figcaption>${esc(caption)}</figcaption></figure>`;
  const slide = (number,title,html) => `<section class="slide"><div class="kicker">ALFAROBOT / ${String(number).padStart(2,'0')}</div><h1>${esc(title)}</h1>${html}<footer>18.10.2026 / tz-1.0.5 / spatial-1.7.2</footer></section>`;
  const slides = [
    slide(1,'От идеи роботизации к решению',`<p class="lead">Подбор, проверка нагрузки, экономика<br>и план пилота на объекте заказчика.</p><div class="stamp">СКЛАД / ПОЛНЫЙ ЦИКЛ МОБИЛЬНОГО СТЕЛЛАЖА</div>`),
    slide(2,'Одних паспортных цифр недостаточно',list(['Робот должен пройти по плану, вовремя зарядиться и выполнить реальный цикл.','Высвободить время сотрудников - не всегда сократить расходы.','Итог расчёта должен объяснять условия внедрения и следующий шаг.'])),
    slide(3,'Один путь для руководителя и инженера',table(['Данные','Решение','Проверка','Внедрение'],[['Объект, план, каталог, источники','Как есть / покупка / RaaS','Поток, очередь, деньги, ограничения','Измерительный пилот и отчёт']])+para('Ключевые выводы видны сразу; формулы, допущения, состав оборудования и телеметрия раскрываются по необходимости.')),
    slide(4,'Два независимых основания доверия',table(['Финансовая привлекательность','Инженерная выполнимость'],[['CAPEX / OPEX / ROI / NPV / TCO','Плотный план / габариты / зарядка / конфликты'],['Денежная реализация труда отдельно','Завершённые доставки отдельно от начала работы'],['Источники, диапазоны и остаточная стоимость','OK / PARTIAL / FAIL / отсутствие измерения']])+para('Положительный NPV не превращает провал нагрузки в рекомендацию.')),
    slide(5,'Перевозится весь мобильный стеллаж',`<div class="visual-grid"><div>${list(['Подача → подхват → перевозка → установка → выезд.','После разгрузки - возврат пустого носителя с тем же ID.','Внутренние задачи расходуют время и энергию, без накрутки потока.'])}${para('Стеллаж 1,4 × 1,0 × 2,2 м, пять ярусов. Реконструкция по фото с явными допущениями.')}</div>${visual('warehouse-current.png','Реальный проектный 3D-просмотр N6/C2, версия 1.7.2. Условный учебный склад, имитация.')}</div>`),
    slide(6,'Модель можно разобрать во времени',`<div class="visual-grid"><div>${list(['Плотный план, конфликты и безопасный отход.','Клик по роботу: модель, задача, телеметрия.','История заданий и состояний; выбор момента.','×1 / ×5 / ×10 / ×50 / ×500 ускоряют воспроизведение.'])}</div>${visual('robot-current.png','Детальная модель и ретроспектива того же N6/C2-проекта. Расчётные данные, подключения к оборудованию нет.')}</div>`),
    slide(7,'Найден проверяемый подходящий вариант',`<div class="metrics"><div><b>${fmt(q.achievedPerH)}</b><small>пал./ч при цели ${fmt(q.requiredPerH)}</small></div><div><b>6 / 2</b><small>роботов / зарядок</small></div><div><b>${money(f.npvRub)}</b><small>NPV покупки</small></div></div>`+para(`OK / очередь ${q.queueEnd} / p95 ${fmt(q.waitP95Min)} мин. Реальный серверный прогон версии 1.7.2, фиксированные вход и seed.`)+para('Учебный пример: 5 000 м² активной зоны, 500 + 500 паллет/день, 20 сотрудников, 120 000 ₽/мес. Денежная реализация высвобождения 100% - явное условие.')),
    slide(8,'Отрицательный результат тоже полезен',proof+para('Двойная нагрузка и сохранённый персонал дают разные причины отказа. Прежние N5/C2 с положительным NPV не выполняют цель потока; такой вариант не маскируется зелёной рекомендацией.')),
    slide(9,'Пилот - часть результата',list(['Участок, состав, длительность и критерии успеха.','Подготовка сети, проходов, покрытия, доков, лифтов и питания.','Смета по статьям с источниками и неизвестными суммами.','Измерения → корректировка → решение о масштабировании.'])+para('Не обещаем мощность полного парка по тесту одного робота.')),
    slide(10,'Результат можно сохранить и защитить',list(['Worker-очередь переживает закрытие вкладки; есть отмена и история.','CALCULATE не публикует черновик; SAVE проверяет редакцию атомарно.','Поздний результат не переписывает новую редакцию или новые локальные правки.','Архив сохраняет прежние числа и версию. PDF / CSV / XLSX относятся к его снимку.'])),
    slide(11,'Границы заявлены открыто',list(['Склад - полный путь; аэропорт и медучреждение - параметры и решения, экономика/имитация прототипные.','Уборка - дополнительное демонстрационное направление.','Нет натурной калибровки, сертификации безопасности, DWG и промышленных интеграций.','Каталожные характеристики, сервис и коммерческие условия требуют проверки поставщиком.'])),
    slide(12,'Что подтверждено перед показом',list(['1903 unit PASS; проверки типов и lint без ошибок.','Реальные серверные и браузерные CREATE → пересчёт → SAVE → повторное открытие → экспорт.','Отмена, поздний SAVE, защита локальных правок и административные операции.',verification.database.slideStatement])+para('Доказательства ограничены локальным выпуском. Следующий шаг - обследование и измерительный пилот с заказчиком.')),
  ].join('');
  const slideCss = `${css}@page{size:320mm 180mm;margin:0}.slide{width:320mm;height:180mm;padding:14mm 18mm;position:relative;break-after:page;overflow:hidden}.slide:last-child{break-after:auto}.slide h1{font-size:30pt;margin:9mm 0}.slide p,.slide li{font-size:16pt;line-height:1.45}.slide li{margin:5mm 0}.slide table{font-size:12pt}.slide .kicker{font-size:10pt}.slide footer{position:absolute;left:18mm;right:18mm;bottom:8mm;border-top:1px solid #b6c9c6;padding-top:3mm;font:9pt Consolas;color:#516d72}.lead{font-size:24pt!important;margin-top:16mm!important}.stamp{border-left:5px solid #17696c;padding:5mm;margin-top:15mm;font:12pt Consolas}.metrics{display:flex;gap:9mm;margin:12mm 0}.metrics>div{flex:1;border-top:3px solid #17696c;padding-top:4mm}.metrics b{display:block;font-size:27pt;color:#17696c}.metrics small{display:block;font-size:12pt;margin-top:4mm}.visual-grid{display:grid;grid-template-columns:1fr 1.8fr;gap:8mm;align-items:start}.visual-grid li,.visual-grid p{font-size:13pt;margin:3mm 0}.visual-grid figure{margin:0}.visual-grid img{width:100%;max-height:99mm;object-fit:contain;object-position:top;border:1px solid #b6c9c6}.visual-grid figcaption{font-size:9pt;line-height:1.4;color:#516d72;margin-top:3mm}`;
  return { documentation: `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Платформа оценки роботизации - документация</title><style>${css}</style><body>${full}</body></html>`, presentation: `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Платформа оценки роботизации</title><style>${slideCss}</style><body>${slides}</body></html>` };
}

async function build() {
  const data = facts(), html = docs(data);
  const browser = await chromium.launch({ headless: true });
  try { for (const name of ['presentation','documentation']) {
    const page = await browser.newPage();
    await page.setContent(html[name], { waitUntil: 'networkidle' });
    const overflow = await page.locator(name === 'presentation' ? '.slide' : '.chapter').evaluateAll(nodes => nodes.map((node,index)=>({ page:index+1, overflow:node.scrollHeight > node.clientHeight+1, height:node.clientHeight, scroll:node.scrollHeight })).filter(n=>n.overflow));
    if (name === 'presentation' && overflow.length) throw new Error(`Slide clipping ${JSON.stringify(overflow)}`);
    await page.pdf({ path: path.join(OUT, `${name}.pdf`), printBackground: true, preferCSSPageSize: true,
      ...(name === 'documentation' ? { displayHeaderFooter:true, headerTemplate:'<span></span>', footerTemplate:'<div style="font:8px Arial;color:#516d72;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>Платформа оценки роботизации / 18.10.2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' } : {}) });
    await page.close();
  } } finally { await browser.close(); }
  const rows=data.examples.map(ex=>`| ${ex.id} | ${fmt(ex.spec.cashRealizationShare*100,0)}% | ${ex.evidence.simModelVersion} | ${ex.evidence.assessment.status} | ${fmt(ex.evidence.summary.achievedPerH)} / ${fmt(ex.evidence.summary.requiredPerH)} | ${ex.evidence.summary.queueEnd} | ${fmt(ex.evidence.summary.waitP95Min)} | ${money(ex.financial.npvRub)} |`).join('\n');
  write('demo-numbers.md', `# Контрольные числа текущего выпуска\n\nЭкономика tz-1.0.5; пространственная модель warehouse-dense-underlift-1.7.2. Источники - реальные серверные receipts в этой папке, не вручную записанные результаты.\n\n| Пример | Денежная реализация труда | Пространственная версия | Статус | Факт / цель, пал./ч | Очередь | p95 начала обработки, мин | NPV покупки |\n|---|---|---|---|---|---|---|---|\n${rows}\n\nОбщие явные учебные допущения: 20 сотрудников по 120 000 ₽/мес; 2 смены по 11 ч; 365 рабочих дней; 5 000 м² активной и 10 000 м² общей площади; пиковый коэффициент 1,2. steady-flow и retained-staff: 500 входящих + 500 исходящих паллет в сутки, всего 1 000; peak-overload: 1 000 + 1 000, всего 2 000. Денежная реализация труда: steady-flow и peak-overload 100%, retained-staff 0%.\n\nОсновной парк N6/C2, входы и seed сохранены в calculation-source.json. Не считать типовой пример данными реального заказчика. Прежний N5/C2 с положительным NPV сохраняется в тестах как физически недостаточный вариант. N14/C1 не объявляется успешным.\n\nОбразец PDF/CSV/XLSX снят с одного сохранённого worker-проекта ${data.source.project.id}, редакция ${data.source.project.revision}. Суммы в документации округлены; JSON сохраняет исходную точность.\n`);
  write('README.md', `# Текущий сдаточный комплект\n\n18.10.2026: tz-1.0.5 / warehouse-dense-underlift-1.7.2.\n\n- presentation.pdf - 12 слайдов продукта и доказательств.\n- documentation.pdf - руководство по функционалу, модели, архитектуре, запуску и границам.\n- sample-report.pdf/csv/xlsx - реальные выгрузки одного сохранённого N6/C2 проекта.\n- calculation-source.json - вход, версия, операция создания и сохранённый результат.\n- steady-flow-receipt.json, peak-overload-receipt.json, retained-staff-receipt.json - реальные серверные ответы.\n- demo-numbers.md - сверяемые контрольные числа.\n- release-manifest.json - SHA256, источник и точные границы приёмки.\n\nУчебные допущения не являются коммерческими условиями заказчика. Локальная приёмка не означает обновление внешнего стенда. Документы прежних версий находятся на уровень выше и остаются архивными.\n`);
  console.log('Built current presentation, documentation and control numbers.');
}

function manifest() {
  const data = facts();
  const walk=(directory,prefix='')=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name),`${prefix}${entry.name}/`):[`${prefix}${entry.name}`]);
  const files = walk(OUT).filter(name=>name !== 'release-manifest.json').map(name=>({ name, bytes:fs.statSync(path.join(OUT,name)).size, sha256:sha(path.join(OUT,name)) }));
  write('release-manifest.json', JSON.stringify({ schemaVersion:'submission-current-1', generatedAt:new Date().toISOString(), versions:{ economics:'tz-1.0.5', analytical:'sim-1.1.0', spatial:'warehouse-dense-underlift-1.7.2' }, source:{ baseUrl:BASE, project:data.source.project, calculationOperation:data.source.operation, capturedAt:data.source.capturedAt, generatorSha256:sha(fileURLToPath(import.meta.url)) }, receipts:data.examples.map(example=>({ id:example.id, calculatedAt:example.results.calculatedAt, modelVersion:example.results.modelVersion, analyticalVersion:example.results.simModelVersion, spatialVersion:example.evidence.simModelVersion, dataVersion:example.results.dataVersion, cashRealizationShare:example.spec.cashRealizationShare, status:example.evidence.assessment.status })), claims:{ qualifiedExample:'steady-flow N6/C2; actual current server receipt; NPV > 0 and spatial OK', negativeExamples:['peak-overload: PARTIAL, negative purchase NPV','retained-staff: physical OK, negative purchase NPV'], unit:'173 files / 1903 PASS in recorded release run', database:read('verification-review.json').database.statement, browser:'Actual current create/recalculate/save/reopen NPV parity/export/copy/delete plus durable cancel/stale/draft guards and admin/public checks', pilot:'Actual numeric/persistence/export verification on spatial 1.7.1; not claimed re-run on 1.7.2', externalDeployment:'Not certified updated', calibration:'Educational inputs and geometry; no industrial safety certification or natural-site calibration' }, visualQa:read('pdf-qa.json'), review:read('verification-review.json'), files }, null, 2));
  console.log(`Manifest: ${files.length} hashed files.`);
}
const command=process.argv[2];
(command==='capture'?capture():command==='report'?report():command==='refresh'?refresh():command==='visuals'?visuals():command==='build'?build():command==='manifest'?Promise.resolve().then(manifest):Promise.reject(new Error('Use capture | report | refresh | visuals | build | manifest'))).catch(error=>{console.error(error);process.exitCode=1;});
