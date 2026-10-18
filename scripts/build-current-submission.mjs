/* Current submission generation requires the complete local app + worker + PostgreSQL,
 * npm dependencies and Playwright Chromium (`npx playwright install chromium`).
 * Set SUBMISSION_BASE_URL and the authorized DEMO_USER_PASSWORD in the process env.
 * New project: capture -> visuals. Existing source: receipts -> refresh -> visuals.
 * Then build -> verify-submission-pdfs.py -> actual independent review metadata -> manifest.
 * The manifest rejects stale versions, worker fingerprints and unreviewed PDF hashes.
 * No credentials, cookies or private environment files are exported. */
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
const section = (n, title, html) => `<section class="chapter${['02','09A','12'].includes(n)?' compact':''}"><div class="kicker">РУКОВОДСТВО / ${n}</div><h1>${esc(title)}</h1>${html}</section>`;
const versionLiteral = (file, name) => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const match = source.match(new RegExp(`export const ${name} = ["']([^"']+)["']`));
  if (!match) throw new Error(`Missing version ${name} in ${file}`);
  return match[1];
};
const localVersions = () => ({
  economics: versionLiteral('lib/tz/version.ts', 'TZ_MODEL_VERSION'),
  analytical: versionLiteral('lib/sim/types.ts', 'SIM_MODEL_VERSION'),
  spatial: versionLiteral('lib/sim/spatial-version.ts', 'SPATIAL_MODEL_VERSION'),
});
const versionsOf = results => ({ economics:results.modelVersion, analytical:results.simModelVersion,
  spatial:results.scenarios.find(spec=>spec.key==='purchase')?.spatialEvidence?.simModelVersion });
function assertCurrentResult(results) {
  const actual=versionsOf(results), expected=localVersions();
  if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`Stale receipt: ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
}
function assertEngineRelease(engineRelease) {
  const fingerprint=JSON.parse(fs.readFileSync(path.join(ROOT,'dist-worker/engine-release.json'),'utf8')).engineRelease;
  if(typeof engineRelease!=='string'||!engineRelease.startsWith(`${fingerprint}/`)) throw new Error('Saved operation does not match the locally built worker fingerprint');
}
const versionText = versions => `${versions.economics} / ${versions.analytical} / ${versions.spatial}`;
const unitStatement = verification => verification.unit?.status==='PASS'
  ? `${verification.unit.filesPassed} файлов, ${verification.unit.testsPassed}/${verification.unit.testsTotal} unit PASS; ${verification.unit.scope}`
  : 'Фактические версии и результаты unit приведены в verification-review.json; прежний прогон не считается новой проверкой.';
const link = (title, href) => `<a href="${esc(href)}">${esc(title)}</a>`;
const packages = () => {
  const lock=JSON.parse(fs.readFileSync(path.join(ROOT,'package-lock.json'),'utf8'));
  const entries=[['next','https://nextjs.org/'],['react','https://react.dev/'],['typescript','https://www.typescriptlang.org/'],
    ['prisma','https://www.prisma.io/'],['pg','https://node-postgres.com/'],['next-auth','https://authjs.dev/'],
    ['bcryptjs','https://github.com/dcodeIO/bcrypt.js'],['tailwindcss','https://tailwindcss.com/'],
    ['@base-ui/react','https://base-ui.com/'],['lucide-react','https://lucide.dev/'],
    ['exceljs','https://github.com/exceljs/exceljs'],['vitest','https://vitest.dev/'],['@playwright/test','https://playwright.dev/']];
  const urls=new Map(entries);
  const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
  return [...new Set([...Object.keys(pkg.dependencies),...Object.keys(pkg.devDependencies)])].filter(name=>!name.startsWith('@types/')).sort().map(name=>({name,version:lock.packages[`node_modules/${name}`]?.version??'см. lockfile',url:urls.get(name)??`https://www.npmjs.com/package/${name}`}));
};


async function captureReceipts(page) {
  const receiptPromise = page.waitForResponse(response => response.url().endsWith('/api/v1/demo-calculation') && response.request().method() === 'POST', { timeout: 120_000 });
    await page.goto(`${BASE}/demo?example=steady-flow`, { waitUntil: 'domcontentloaded' });
    const response = await receiptPromise;
    if (response.status() !== 200) throw new Error(`Demo calculation HTTP ${response.status()}`);
    const submitted = response.request().postDataJSON();
    const publicReceipt = await response.json();
    assertCurrentResult(publicReceipt.results);
    write('steady-flow-receipt.json', JSON.stringify(publicReceipt, null, 2));
    for (const key of ['peak-overload', 'retained-staff']) {
      const pending=page.waitForResponse(response=>response.url().endsWith('/api/v1/demo-calculation')&&response.request().method()==='POST',{timeout:120_000});
      await page.goto(`${BASE}/demo?example=${key}`,{waitUntil:'domcontentloaded'});
      const actual=await pending;
      if(actual.status()!==200) throw new Error(`${key} calculation HTTP ${actual.status()}`);
      const receipt=await actual.json();
      assertCurrentResult(receipt.results);
      write(`${key}-receipt.json`,JSON.stringify(receipt,null,2));
    }
  return submitted;
}

async function receipts() {
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setExtraHTTPHeaders({'x-forwarded-for':`submission-current-${crypto.randomUUID()}`});
    await captureReceipts(page);
    console.log(JSON.stringify({receipts:3,versions:localVersions()}));
  } finally {await browser.close();}
}

async function capture() {
  if (!process.env.DEMO_USER_PASSWORD) throw new Error('Set DEMO_USER_PASSWORD for the authorized local demo account');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(20_000);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': `submission-current-${crypto.randomUUID()}` });
    const submitted = await captureReceipts(page);
    await page.goto(`${BASE}/login`);
    await page.locator('#email').fill('demo@demo.local');
    await page.locator('#password').fill(process.env.DEMO_USER_PASSWORD);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/projects');
    const result = await page.request.post(`${BASE}/api/v1/calculation-jobs`, {
      data: { operation: 'CREATE', name: 'Сдаточный пример - полный цикл мобильного стеллажа', facility: 'warehouse', params: submitted.params, scenarios: submitted.scenarios },
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
    assertEngineRelease(completed.job.engineRelease);
    if(completed.job.publicationState!=='PUBLISHED') throw new Error('CREATE not published');
    const projectId = completed.job.projectId;
    const rawProject = await (await page.request.get(`${BASE}/api/v1/projects/${projectId}`)).json();
    const results = completed.results;
    const purchase = results.scenarios.find(s => s.key === 'purchase');
    assertCurrentResult(results);
    if (purchase?.spatialEvidence?.assessment.status !== 'OK') throw new Error('Qualified current source not established');
    const financial = results.results.find(r => r.key === 'purchase');
    if (!(financial.npvRub > 0) || !(financial.items[0].n > 0) || !(financial.items[0].chargers >= 0)) throw new Error('Unexpected qualified financial source');
    write('calculation-source.json', JSON.stringify({ capturedAt: new Date().toISOString(), baseUrl: BASE, project: { id: projectId, name: rawProject.name, revision: rawProject.revision }, operation: { id, kind: 'CREATE', status: job.status, publication: completed.job.publicationState, engineRelease:completed.job.engineRelease }, submitted: { facility: 'warehouse', params: submitted.params, scenarios: submitted.scenarios }, results }, null, 2));
    for (const extension of ['csv', 'xlsx']) {
      const exported = await page.request.get(`${BASE}/projects/${projectId}/export.${extension}`, { timeout: 60_000 });
      if (exported.status() !== 200) throw new Error(`Export ${extension} HTTP ${exported.status()}`);
      write(`sample-report.${extension}`, await exported.body());
    }
    await page.goto(`${BASE}/projects/${projectId}/report?scenario=purchase`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name:purchase.name, exact:true }).first().waitFor();
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
    await page.getByRole('heading', { name:source.results.scenarios.find(spec=>spec.key==='purchase').name, exact:true }).first().waitFor();
    await page.emulateMedia({ media:'print' });
    if(process.argv[2]!=='report-image') await page.pdf({ path:path.join(OUT,'sample-report.pdf'), format:'A4', printBackground:true, preferCSSPageSize:true });
    await page.emulateMedia({ media:'screen' });
    await page.screenshot({ path:path.join(OUT,'sample-report.png') });
    console.log(JSON.stringify({ projectId:source.project.id, report:process.argv[2]==='report-image'?'screen-captured':'printed' }));
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
    assertEngineRelease(completed.job.engineRelease);
    if(completed.job.publicationState!=='PUBLISHED') throw new Error('SAVE not published');
    const after=await(await page.request.get(`${BASE}/api/v1/projects/${source.project.id}`)).json();
    if(after.revision!==before.revision+1) throw new Error('SAVE revision did not advance exactly once');
    const prev=source.results.scenarios.find(s=>s.key==='purchase').spatialEvidence;
    const next=completed.results.scenarios.find(s=>s.key==='purchase').spatialEvidence;
    assertCurrentResult(completed.results);
    if(next.assessment.status!=='OK') throw new Error('Refreshed source is not workload-qualified');
    const previousFinancial=source.results.results.find(r=>r.key==='purchase');
    const currentFinancial=completed.results.results.find(r=>r.key==='purchase');
    if(!(currentFinancial.npvRub>0)) throw new Error('Refreshed source is not financially qualified');
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
    await page.getByRole('heading',{name:source.results.scenarios.find(spec=>spec.key==='purchase').name,exact:true}).first().waitFor();
    await page.emulateMedia({media:'print'});
    await page.pdf({path:path.join(OUT,'sample-report.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
    await page.emulateMedia({media:'screen'});
    await page.screenshot({path:path.join(OUT,'sample-report.png')});
    console.log(JSON.stringify({project:source.project,operation:source.operation,physicsUnchanged:JSON.stringify(prev.summary)===JSON.stringify(next.summary),npvUnchanged:previousFinancial.npvRub===currentFinancial.npvRub}));
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
    const expected=source.results.scenarios.find(spec=>spec.key==='purchase').spatialEvidence;
    if(snapshot.input.robots.count!==expected.summary.fleet || snapshot.assessment.status!=='OK' || snapshot.summary.simModelVersion!==expected.simModelVersion) throw new Error('Visual proof does not match the qualified source');
    await child.locator('#stage').scrollIntoViewIfNeeded();
    await child.locator('#stage').screenshot({path:path.join(OUT,'assets/warehouse-current.png')});
    const robot=snapshot.frame.robots.find(r=>r.loaded)||snapshot.frame.robots[0];
    await child.locator(`#fleet-rows tr[data-robot-id="${robot.id}"] button`).click();
    await child.locator('dialog[open]').waitFor();
    await child.locator('#rd-canvas canvas').waitFor();
    await child.waitForTimeout(800);
    await child.locator('dialog[open]').screenshot({path:path.join(OUT,'assets/robot-current.png')});
    write('visual-source.json',JSON.stringify({capturedAt:new Date().toISOString(),project:source.project.id,projectRevision:source.project.revision,engineRelease:source.operation.engineRelease,simulationTimeS:snapshot.frame.tS,fleet:snapshot.input.robots.count,chargers:snapshot.input.layout.chargers,assessment:snapshot.assessment,summary:snapshot.summary,projectOrigin:snapshot.projectOrigin,robotId:robot.id},null,2));
    console.log(JSON.stringify({visuals:'captured',fleet:snapshot.input.robots.count,chargers:snapshot.input.layout.chargers,status:snapshot.assessment.status,robotId:robot.id}));
  } finally {await browser.close();}
}

function facts() {
  const source=read('calculation-source.json');
  assertCurrentResult(source.results);
  assertEngineRelease(source.operation.engineRelease);
  const versions=versionsOf(source.results);
  const examples=['steady-flow','peak-overload','retained-staff'].map(id=>{
    const results=read(`${id}-receipt.json`).results;
    assertCurrentResult(results);
    const spec=results.scenarios.find(spec=>spec.key==='purchase');
    const financial=results.results.find(result=>result.key==='purchase');
    return {id,results,spec,financial,evidence:spec.spatialEvidence};
  });
  const spec=source.results.scenarios.find(spec=>spec.key==='purchase');
  const financial=source.results.results.find(result=>result.key==='purchase');
  if(spec.spatialEvidence?.assessment.status!=='OK'||!(financial?.npvRub>0)) throw new Error('Saved qualification absent; choose a real passing configuration before building');
  const positive={results:source.results,spec,financial,evidence:spec.spatialEvidence};
  const date=new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeZone:'Europe/Moscow'}).format(new Date(source.capturedAt));
  return {source,examples,positive,versions,date};
}

function docs(data) {
  const {source,examples,versions,date}=data, qualified=data.positive, q=qualified.evidence.summary, f=qualified.financial;
  const fleet=f.items[0].n,chargers=f.items[0].chargers;
  const assumption=`Учебный пример: ${fmt(source.results.paramsUsed.activeAreaM2,0)} м² активной зоны, ${fmt(source.results.paramsUsed.totalAreaM2,0)} м² общей площади, ${source.results.paramsUsed.inboundPalletsPerDay} + ${source.results.paramsUsed.outboundPalletsPerDay} + ${source.results.paramsUsed.internalPalletMovesPerDay??0} клиентских операций/день (приёмка / отгрузка / внутренние перемещения), ${source.results.paramsUsed.forkliftOperatorsCount} сотрудников по ${fmt(source.results.paramsUsed.forkliftSalaryRubMonth,0)} ₽/мес; ${source.results.paramsUsed.shiftsPerDay} × ${source.results.paramsUsed.shiftDurationH} ч, ${source.results.paramsUsed.workDaysPerYear} дней/год; пик ${source.results.paramsUsed.peakFactor}; денежная реализация ${fmt(qualified.spec.cashRealizationShare*100,0)}%.`;
  const scoreRows=[['scoreWeightEcon','Экономика покупки'],['scoreWeightData','Качество данных'],['scoreWeightMaturity','Зрелость'],['scoreWeightMargin','Технический запас'],['scoreWeightCases','Подтверждённые кейсы']].map(([key,label])=>[label,fmt(source.results.normsUsed[key]*100,0)+'%']);
  const verification=read('verification-review.json');
  if(JSON.stringify(verification.versions)!==JSON.stringify(versions)) throw new Error('Verification metadata must explicitly bind to the current source versions before PDF authoring');
  const exampleRows = examples.map(ex => [ex.id, `${ex.financial.items[0].n} / ${ex.financial.items[0].chargers}`, ex.evidence.assessment.status, `${fmt(ex.evidence.summary.achievedPerH)} / ${fmt(ex.evidence.summary.requiredPerH)}`, `${ex.evidence.summary.queueEnd} / ${fmt(ex.evidence.summary.waitP95Min)}`, money(ex.financial.npvRub)]);
  const proof = table(['Пример','N / C','Физика','Факт / цель, пал./ч','Очередь / p95, мин','NPV покупки'], exampleRows);
  const css = `*{box-sizing:border-box}body{margin:0;color:#142d32;font-family:Arial,sans-serif;background:white}h1,h2,h3{letter-spacing:-.025em}h1{font-size:27pt;line-height:1.08;margin:10mm 0 9mm}h2{font-size:16pt;margin:8mm 0 4mm}p,li{font-size:11pt;line-height:1.48}p{margin:0 0 4mm}li{margin:2.5mm 0}ul{padding-left:6mm}table{width:100%;border-collapse:collapse;margin:6mm 0;font-size:9pt;line-height:1.4;table-layout:fixed}th{background:#dfe9e6;text-align:left}td,th{padding:3mm;border-bottom:1px solid #b6c9c6;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}.kicker{font:9pt Consolas,monospace;letter-spacing:.1em;color:#17696c;border-top:3px solid #17696c;padding-top:4mm}.chapter{break-before:page}.chapter:first-child{break-before:auto}.chapter.compact p{font-size:10pt;line-height:1.4;margin-bottom:3mm}.chapter.compact td,.chapter.compact th{padding:2mm}.chapter.compact table{margin:4mm 0;font-size:8.5pt;line-height:1.3}.chapter.compact h1{margin:8mm 0 7mm}.note{border-left:3px solid #17696c;padding:4mm;background:#edf3ef}.metric{font-size:30pt;font-weight:bold;color:#17696c}code,pre{font:9pt/1.5 Consolas,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#edf1ef;padding:5mm}small{font-size:9pt;line-height:1.4;color:#516d72}@page{size:A4;margin:16mm 16mm 18mm}`;
  const full = [
    section('00','Платформа оценки роботизации',para('От исходных данных объекта до проверяемого решения и плана пилота.')+para('Основной процесс: складская перевозка паллет с поддомкрачивающим роботом и замкнутым циклом мобильного стеллажа. Дополнительное демонстрационное направление - уборка.')+`<div class="note"><b>${esc(date)}</b><p>${esc(versionText(versions))}</p></div>`+para('Этот документ сопровождает текущий локальный выпуск. Результаты учебные: они относятся к указанным данным, геометрии, seed и политике диспетчеризации. Статус модели не заменяет обследование и натурный пилот.')),
    section('01','Для кого и какой результат',para('Руководитель получает сравнение покупки, RaaS и текущего процесса, стоимость и ограничения внедрения. Инженер проверяет планировку, цикл, зарядку, очереди и телеметрию. Интегратор получает план обследования и измерительного пилота.')+table(['Область','Текущий объём'],[['Склад','Полный путь: параметры, подбор, деньги, физическая проверка, сохранение и экспорт'],['Аэропорт и медучреждение','Выбор типа объекта, параметры, каталог решений. Экономика и динамическая имитация обозначены как прототип'],['Уборка','Отдельное дополнительное 3D-демо. Не заменяет основную складскую проверку']])+list(['1. Выбрать объект и указать исходные данные с источниками.','2. Проверить применимость и причины исключения продуктов.','3. Сравнить состав оборудования, финансы и физическую выполнимость.','4. Настроить план пилота, сохранить проект и передать отчёт.'])),
    section('02','Каталог, данные и подбор',para('Каталог организован по отрасли, объекту, процессу и типу решения. Поиск, фильтры, сортировка и сравнение помогают отобрать продукты. Карточка хранит происхождение, источники и качество характеристик. Неизвестные ТТХ и ставки не превращаются в ноль.')+para('Подбор сначала применяет жёсткие технические ограничения. Вклад факторов объяснимого score доступен отдельно. Ручное добавление требует причины и оставляет предупреждение. Балл не подтверждает пригодность на конкретном объекте.')+para('Алгоритм: 1) процесс и тип объекта; 2) жёсткие требования и отдельная проверка пробелов ТТХ; 3) расчёт парка, зарядок и экономики допустимых кандидатов; 4) нормированные факторы score и сортировка; 5) отдельная проверка нагрузки и рекомендации. Итоговый score = round(100 × Σ(вес × фактор)), факторы от 0 до 1; веса нормируются по сумме. Экономическая часть — NPV покупки, нормированный min–max среди кандидатов с рассчитанным NPV; один кандидат или равные NPV дают фактор 1. При равном балле применяется детерминированная сортировка.')+table(['Фактор score','Вес снимка'],scoreRows)+para('Победитель подбора — финансовый кандидат, а не автоматически подтверждённое инженерное решение. Причины исключения и вклады факторов показываются пользователю; ручной выбор не отменяет физические ограничения.')+table(['Вход','Как проверяется'],[['Параметры объекта','Единицы, диапазоны, обязательность, источники, предупреждения качества'],['Excel / CSV','Предпросмотр, сопоставление полей и применение; максимум файла 950 000 байт'],['Схема','Планировка и граф сохраняются с расчётом; нативный DWG/AutoCAD пока не входит'],['Продукт','Применимость процесса, масса, габариты, ограничения и отсутствующие характеристики']])+para('Карточка поддерживаемого продукта передаёт выбранную модель в покупку и RaaS. Неизвестный или неприменимый продукт получает объяснение, без скрытой подмены роботом по умолчанию.')),
    section('03','Деньги и физика отвечают на разные вопросы',para('Расчётное приложение к этому руководству — sample-report.pdf того же сохранённого проекта: приложения В–Е содержат постатейные формулы, подстановки, единицы, денежные потоки и нормативы; приложение Ж — происхождение и ссылки данных. JSON и таблицы рядом сохраняют точность исходных чисел.')+para('Финансовая модель считает CAPEX, OPEX, денежный эффект, ROI, NPV, TCO и окупаемость. Физическая проверка отвечает, обработает ли этот парк заданную нагрузку на этом плане. Положительный NPV не снимает ограничение потока.')+table(['Показатель','Смысл'],[['NPV','-CAPEX плюс дисконтированные чистые годовые потоки и допустимая остаточная стоимость'],['ROI','Накопленный чистый эффект за вычетом инвестиций относительно инвестиций'],['Окупаемость','Время возврата инвестиций; если возврат не достигается, это показано явно'],['TCO','Совокупные затраты минимум за 5 лет; замены оборудования и АКБ учитываются отдельно']])+para('Высвобождение труда и экономия фонда оплаты труда разделены. cashRealizationShare определяет, какая часть высвобождения превращается в денежную экономию. Если сотрудники остаются, увеличение свободного времени само по себе не снижает ФОТ.')+para('Годовой охват нагрузки задаётся отдельно и ограничен расчётной мощностью. Часовой прогон не превращается автоматически в годовую экономию. Кредит, налог на прибыль, инфляция, дополнительный доход и предотвращённые потери базовой моделью не оцениваются.')),
    section('04','Покупка, услуга и допущения',para('Покупка включает состав оборудования, комплектность, внедрение и эксплуатационные расходы. Пакеты учитывают включённые ПО, ремонт и зарядки без двойной оплаты. Оценки не равны коммерческому предложению.')+para('RaaS моделируется договором на 12 месяцев с ежегодным продлением, фиксированной месячной ставкой и без выкупа. Оборудование, зарядки, ПО, сервис, ремонт, расходники и АКБ приняты включёнными; интеграция и обучение отдельно. Эти условия требуют проверки договором.')+para('Чистая остаточная стоимость по умолчанию 0. Ручная оценка учитывается один раз в конце периода TCO; входит в NPV только если горизонт NPV достигает этой даты. Она не увеличивает операционный эффект.')+para('Каталожные цены приняты с НДС. Логистика полного внедрения отдельно не подтверждена и относится к сметному резерву CAPEX; в пилоте доставка выделена отдельной статьёй с источником либо статусом неизвестной суммы.')+para('Срок службы, производительность на объекте, местный сервис, стоимость логистики и подключение лифтов/доков должны уточняться до закупки. Диапазоны чувствительности помогают увидеть, какие допущения меняют решение.')),
    section('05','Полный транспортный цикл',para('Процесс closed-pod-1 связывает экономику и одну каноническую пространственную сводку. Робот подаёт носитель, заезжает под стеллаж, поднимает, перевозит, устанавливает и выезжает; после разгрузки возвращает пустой носитель. Служебные подачи и возвраты расходуют время и энергию, но не добавляют клиентских перевозок.')+para('Состав клиентского потока берётся из трёх суточных объёмов: приёмка, отгрузка и внутренние перемещения. Для внутренних перемещений резервируется свободное место хранения; базовые 10% вакансий — оценка, округляемая вниз, а не данные обследования. При отсутствии свободного назначения внутренний перенос не подтверждается. Товарные остатки и конкретная номенклатура не моделируются.')+table(['Модель','Объём'],[['closed-pod-1','Поддомкрачивающий робот; плотные мобильные стеллажи; приёмка/отгрузка с подачей/возвратом; внутренний перенос между местами хранения; подхваты, установки, порожний ход и безопасный выезд'],['single-leg-pallet-1','Вилочный робот или тягач; отдельная аналитика одиночной паллетной перевозки без 3D-подтверждения подхвата стеллажа']])+para('Учебный стеллаж: 1,4 × 1,0 × 2,2 м, пять ярусов; робот визуально реконструирован по фотографиям. Плотная раскладка, проходы, препятствия и граф учитываются при движении. Это параметрическая реконструкция с допущениями, а не подтверждённая CAD-модель производителя.')+para('Прямой отход задним ходом сохраняет ориентацию носителя до участка, где разрешён разворот. Проверки геометрических зазоров и конфликтов траекторий сохраняются; роботы не получают разрешение проходить друг через друга. Люди, тормозной путь и сертификация промышленной безопасности не моделируются.')),
    section('06','Как читать результат имитации',table(['Статус','Значение'],[['OK','Все объявленные критерии выполнены для этого входа, seed, окна и версии'],['PARTIAL','Прогон завершён, но есть измеренное ограничение потока, очереди, ожидания или другого критерия'],['FAIL','Нарушение проверяемого условия модели, в том числе безопасности'],['NOT_EVALUATED','Достаточной завершённой оценки нет; отсутствующее измерение не равно нулю']])+para('Начало обработки клиентской заявки включает назначенную внутреннюю подачу носителя для этой заявки. Очередь и p95 измеряют ожидание до начала обработки. Это не завершённая доставка: выходной поток считает завершённые клиентские заявки приёмки, отгрузки и объявленных внутренних перемещений. Служебная подача и возврат носителя не увеличивают клиентский поток.')+para('Отчёт показывает достижение нагрузки, очередь, p95, безопасность, энергию и восстановление после инцидентов. Вердикт не строится только на доле начатых заданий. На карте доступны роботы, носители, секции, зарядки, маршруты и инциденты; по клику - модель и детали робота, внизу - история заданий и состояний.')+para('Скорости ×1, ×5, ×10, ×50 и ×500 ускоряют воспроизведение, а не физические скорости. Ретроспектива показывает состояние выбранного момента, включая полный и пустой носитель. Один удачный seed не доказывает глобальный оптимум или натурную мощность объекта.')),
    section('07','Три воспроизводимых примера',proof+para(`Квалифицированный пример: ${fmt(q.achievedPerH)} пал./ч при цели ${fmt(q.requiredPerH)}, очередь ${q.queueEnd}, p95 ${fmt(q.waitP95Min)} мин. N${fleet}/C${chargers}. NPV покупки ${money(f.npvRub)}.`)+para(assumption+' Полные различия трёх входов сохранены в receipts; это не данные заказчика.')+para('steady-flow доказывает существование подходящего модельного варианта. peak-overload увеличивает приёмку и отгрузку; фактический статус показан в таблице. retained-staff сохраняет физический вход, но убирает денежную экономию ФОТ. Положительный NPV не делает недостаточный поток подходящим; статус текущей конфигурации берётся только из её собственного прогона.')+para('Исходники трёх результатов включены в этот комплект. Квалифицированный образец отчёта получен из реально созданного worker-проекта; PDF/CSV/XLSX относятся к одному сохранённому результату.')),
    section('08','От расчёта к пилоту',para('Следующий шаг зависит от найденного ограничения. Для физически и финансово подходящего сценария готовится измерительный пилот. При нехватке потока сначала меняют конфигурацию или процесс и повторяют проверку; весь поток небольшому тестовому парку не обещается.')+table(['План','Что фиксируется'],[['Участок и состав','Роботы, зарядки, длительность, покупка или услуга'],['Подготовка','План, проходы, покрытия, сеть, доки, лифты, электропитание, базовый процесс'],['Смета','Оборудование, зарядки, доставка, интеграция, подготовка, обучение и другие статьи с источниками'],['Критерии','Поток участка, p95 ожидания, ручные вмешательства, правила остановки'],['Результат','Сопоставление измерений с базой и решение о корректировке/масштабировании']])+para('Неизвестные суммы остаются неизвестными. Смета пилота не масштабирует автоматически мощность полного парка на один-два робота. Пилот имеет собственный состав и бюджет.')+para('Проверки пилота имеют собственные вход, версию и границы, записанные в verification-review.json. Пройденный тест прежнего выпуска не объявляется новым тестом текущей пространственной версии.')),
    section('09','Сервер, очередь и целостность',para('Next.js / React / TypeScript, Prisma и PostgreSQL. Чистый расчётный движок обслуживает интерфейс, API и отдельный Node.js worker. БД хранит принятые входы, снимки справочников, очередь и завершённые результаты.')+table(['Операция','Поведение'],[['CREATE','Создать проект после успешного серверного расчёта'],['CALCULATE','Посчитать текущий черновик; не менять опубликованные params/results/revision'],['SAVE','Рассчитать и опубликовать при совпадении редакции проекта'],['RECALCULATE','Явно обновить существующий проект по актуальным принятым справочникам']])+para('Принятое фоновое задание переживает закрытие вкладки. Есть история, этапы, отмена и восстановление lease. Поздний SAVE сохраняется отдельно как STALE и не переписывает новую редакцию. Публикация проверяет отмену, lease и revision в одной транзакции.')+para('Revision/CAS защищает от потери правок между вкладками. Новые локальные правки не затираются пришедшим ответом на предыдущий ввод. Сервер сам повторяет физический расчёт; присланный клиентом OK не является достаточным подтверждением.')+para('Архив открывается из сохранённого снимка без нового расчёта. Историческая пространственная версия сохраняет прежний статус и показатели и явно не выдаётся за подтверждение текущего контроллера. Копирование позволяет работать дальше, сохраняя исходный архив.')),
    section('09A','Структура данных и API',table(['Сущность','Содержимое и связь'],[['Project / Scenario','Владелец, тип объекта, params/results, revision, версии модели и данных; сценарии принадлежат проекту. Результат содержит замороженные продукты, нормативы и runtime-входы.'],['CatalogProduct / ProductCharacteristic','Продукт и характеристики; значение, единица, ссылка, дата и подтверждение источника.'],['ParamDefinition / Norm / DataRelease','Правила полей, нормативы и выпуск каталожных данных, из которых принимается расчётный снимок.'],['CalculationRun','Принятый вход, снимок справочников и результат вычисления для воспроизводимости.'],['CalculationJob / CalculationSubmission','Задание с lease/состоянием/heartbeat и привязка клиентской операции с idempotency/revision; публикация проверяется атомарно.'],['ChangeLog','Журнал действий с проектами и справочниками. Файлы импорта не сохраняются.']])+table(['Контракт','Результат'],[['POST /api/v1/calculation-jobs','Cookie владельца, Idempotency-Key и JSON операции; 202 с receipt. SAVE требует projectId и expectedRevision.'],['GET /api/v1/calculation-jobs; GET /:id','Список собственных операций или состояние/этап конкретного задания.'],['GET /api/v1/calculation-jobs/:id/result','202 пока не завершено; завершённый результат отдельно от статуса публикации PUBLISHED/STALE.'],['POST /api/v1/calculation-jobs/:id/cancel; DELETE /:id','Запрос отмены; явное удаление завершённого технического результата. Проверяется владелец.'],['GET /api/v1/catalog; GET /api/v1/projects/:id','Чтение каталога и собственного сохранённого проекта; чужой проект не раскрывается.'],['POST /api/v1/demo-calculation','Гостевой HTTP-расчёт без публикации проекта и гарантий долговременной очереди.']])+para('Ошибки возвращают статус и код: невалидный ввод400/422, отсутствие доступа401/403, неизвестный объект404, конфликт редакции409, переполнение429, недоступность/бюджет503. У отдельных обработчиков свои коды; точная схема и лимиты доступны в /api-docs и docs/CALCULATION_JOBS.md. Базовые API чтения и административные операции описаны в docs/INTEGRATIONS.md.')),
    section('10','Интерфейсы и администрирование',table(['Маршрут','Назначение'],[['/demo','Текущий гостевой расчёт и три учебных примера'],['/projects','Собственные проекты, редактор и сохранённые архивы'],['/calculation-jobs','История фоновых операций, результат и отмена'],['/demo/warehouse; /demo/cleaning','Основной пространственный и дополнительный демонстрационные сценарии'],['/catalog; /methodology/tz','Каталог, источники и методика'],['/admin','Каталог, характеристики, нормы, параметры, обновление и журнал'],['/api-docs','Описание API/OpenAPI']])+para('Авторизованный расчёт использует POST /api/v1/calculation-jobs. Гостевой POST /api/v1/demo-calculation считает актуальный ввод внутри HTTP-запроса без создания проекта или долговременной очереди. Закрытие гостевой вкладки не имеет гарантий продолжения фонового задания.')+para('Есть импорт проектов, каталога и нормативов. WMS/ERP/1С и государственные интеграции описаны как направления, а не как работающие подключения. Доступ к собственным проектам, архивам и отчётам проверяется по владельцу; административные операции требуют соответствующей роли.')),
    section('11','Воспроизведение и ограничения',`<h2>Docker</h2><pre>docker compose up --build\n# http://localhost:3000\n# GET /api/health</pre>`+para('Compose поднимает PostgreSQL, миграции, сев, приложение и worker. Первоначальная сборка требует сеть. APP_PORT и DB_PORT задают порты. Для внешнего контура нужны собственные секреты и HTTPS; демонстрационные учётные данные из README предназначены для локального показа.')+`<h2>Локальный Node.js и PostgreSQL</h2><pre>npm ci\nnpx prisma migrate deploy\nnpm run db:seed\nnpm run build\nnpm start\n# второй терминал с тем же окружением:\nnpm run worker</pre>`+para('Node.js 20.19+ в ветке 20, 22.12+ в ветке 22 либо 24+; PostgreSQL 16+. Создать .env по .env.example. App и worker должны иметь одинаковый fingerprint расчётного движка. После правки расчётного кода пересобрать и перезапустить оба.')+para('Вход API ограничен 4 МиБ JSON UTF-8. Очередь допускает до двух действующих lease, двух активных операций владельца и ста ожидающих. Это политика допуска, а не доказательство неограниченной производительности. Полный расчёт имеет абсолютный бюджет 60 с, пространственная часть - до 45 с внутри него.')+para('Не входят: нативный DWG/AutoCAD, полный мировой каталог и расписание парсинга, натурная калибровка, промышленная сертификация безопасности, утверждённый контур персональных данных и работающие промышленные/государственные интеграции.')),
    section('12','Проверки и границы доказательств',table(['Проверка','Подтверждение и граница'],[['Unit',unitStatement(verification)],['Числа и выгрузки',verification.numbers?.scope??'Точный отдельный объём проверки приведён в verification-review.json'],['Типы, lint, diff','Ошибок не выявлено в выполненных проверках исходников'],['База данных',verification.database?.statement??'Текущий DB-прогон не заявлен; точные исторические границы перечислены в verification-review.json'],['Браузер',verification.browser],['Пилот',verification.pilot],['Нагрузка','Исторические 50 пользователей проверяли чтение/формы прежнего выпуска; это не тест 50 одновременных вычислений новой очереди']])+para('Этот набор доказательств не означает «все требования ТЗ закрыты» и не является промышленным SLA. Внешний стенд и публикация исходников не объявляются обновлёнными локальным тестом. Непроверенные сочетания ввода, иные seed и неизвестные свойства оборудования требуют отдельной проверки.')+para('Источники комплекта: текущие README, docs/CALCULATION_JOBS.md, docs/LIMITATIONS.md, /methodology/tz; расчётные версии в исходниках; calculation-source.json и три реальных серверных receipt. SHA256 файлов и точные границы приёмки перечислены в release-manifest.json.')),
    section('13','Источники и внешние библиотеки',para('Исходная база: конкурсные материалы ФЦ БАС (ТЗ, каталог решений и ценовые материалы); каталожные сведения производителей и поставщиков; экспертные и ручные оценки, отмеченные как допущения. Исходные паспортные цифры не являются измерениями производительности на объекте. Для каждого существенного поля в каталоге сохраняются тип и ссылка источника; при отсутствии подтверждения поле остаётся неизвестным. Полный провенанс принятого образца с URL, датами и статусами подтверждения входит в расчётное приложение sample-report.pdf (приложение Ж); его параметры приведены в приложении А.')+`<p>${link('Происхождение и приоритет источников','../../data-provenance.md')} · ${link('Справочники и обновление','../../data-provenance.md')} · ${link('Точный снимок расчёта','./calculation-source.json')} · ${link('Ronavi: исходный источник оценки TCO','https://ronavi-robotics.ru/media/tpost/l8s0fty3m1-kak-schitat-stoimost-vladeniya-tco-logis')}</p>`+para('Ниже перечислены используемые библиотеки и версии из package-lock.json. Их сайты и репозитории содержат документацию и лицензионные условия; это не внешние работающие интеграции.')+`<table><thead><tr><th>Библиотека / версия</th><th>Ссылка</th></tr></thead><tbody>${packages().map(item=>`<tr><td>${esc(item.name)} ${esc(item.version)}</td><td>${link(item.url,item.url)}</td></tr>`).join('')}</tbody></table>`+`<p>Автономная 3D-страница также включает vendored Three.js r128 и OrbitControls r128 (MIT): ${link('Three.js r128','https://github.com/mrdoob/three.js/tree/r128')}, ${link('OrbitControls','https://github.com/mrdoob/three.js/blob/r128/examples/js/controls/OrbitControls.js')}, ${link('MIT license','https://github.com/mrdoob/three.js/blob/r128/LICENSE')}. Это встроенные зависимости, не запись npm-каталога.</p>`),
    section('14','Руководства и изменение данных',`<h2>Пользователь</h2>`+list(['Откройте /demo или создайте проект после входа. Выберите тип объекта и задайте параметры с источниками; проверьте предупреждения.','В подборе изучите технические исключения, score и качество данных. Сформируйте сравнимые сценарии покупки и RaaS.','Откройте имитацию: План, маршруты, запуск/пауза/перезапуск, скорость и ретроспектива используют тот же вход. Сопоставьте цель с завершённым потоком, очередью и p95.','Проверьте решение и ограничения. Сформируйте план пилота. SAVE публикует результат при совпадении редакции; дождитесь завершения в /calculation-jobs.','Откройте сохранённый проект и экспортируйте PDF/CSV/XLSX. Для обновления старого снимка явно пересчитайте его или создайте копию.'])+`<h2>Администратор</h2>`+list(['В /admin найдите продукт, параметр либо норматив. Сначала проверьте единицы, допустимый диапазон, источник и дату.','Для импорта каталога или нормативов выполните предпросмотр, исправьте ошибки и только затем примените пакет. Проверьте журнал изменений.','Изменение справочника действует на новые принятые расчёты. Сохранённые архивы не пересчитываются при открытии.','После изменения расчётного кода пересоберите app и worker вместе. Сверьте fingerprint; /api/health проверяет приложение/БД, а не наличие живого worker.'])+`<p>Подробные инструкции в составе репозитория: ${link('пользователь','../../USER-GUIDE.md')}, ${link('администратор','../../ADMIN-GUIDE.md')}, ${link('данные','../../data-provenance.md')}, ${link('развёртывание','../../DEPLOY.md')}, ${link('очередь/API','../../CALCULATION_JOBS.md')}, ${link('демонстрационный сценарий','../../DEMO-SCRIPT.md')}.</p>`),
    section('15','План развития и критерии перехода',table(['Направление','Сейчас','Следующий проверяемый результат'],[['Калибровка','Учебные параметры, фиксированный seed, модельные критерии','Замер циклов, ожидания, заряда и вмешательств на пилоте; калибровка и повторные прогоны'],['CAD','Параметрический план и граф, без нативного DWG','Импорт схемы с масштабом и проверкой проходимости до расчёта'],['WMS / ERP / диспетчер','Нет промышленного подключения','Согласованный контракт задач/состояний, стенд и подтверждённый обмен'],['Аэропорт / медицина','Параметры и каталог; экономика/имитация прототипные','Отдельные валидированные процессы и исходные данные'],['Каталог','Редактирование, импорт и происхождение полей','Проверенные коммерческие предложения, сервис и производительность на объектах'],['Контур эксплуатации','Локальный app/worker/БД','Выбор контура, мониторинг, резервирование и необходимые правовые процедуры']])+para('План развития не описывает уже работающие функции. Приоритет — измерительный пилот и данные, которые меняют инженерное и финансовое решение.')),
  ].join('');
  const asset=name=>`data:image/png;base64,${fs.readFileSync(path.join(OUT,'assets',name)).toString('base64')}`;
  const visual=(name,caption)=>`<figure><img src="${asset(name)}"><figcaption>${esc(caption)}</figcaption></figure>`;
  let slideNumber=0;
  const slide = (_number,title,html) => `<section class="slide"><div class="kicker">ALFAROBOT / ${String(++slideNumber).padStart(2,'0')}</div><h1>${esc(title)}</h1>${html}<footer>${esc(date)} / ${esc(versions.economics)} / ${esc(versions.spatial)}</footer></section>`;
  const slides = [
    slide(1,'От идеи роботизации к решению',`<p class="lead">Подбор, проверка нагрузки, экономика<br>и план пилота на объекте заказчика.</p><div class="stamp">СКЛАД / ПОЛНЫЙ ЦИКЛ МОБИЛЬНОГО СТЕЛЛАЖА</div>`),
    slide(2,'Одних паспортных цифр недостаточно',list(['Робот должен пройти по плану, вовремя зарядиться и выполнить реальный цикл.','Высвободить время сотрудников - не всегда сократить расходы.','Итог расчёта должен объяснять условия внедрения и следующий шаг.'])),
    slide(3,'Один путь для руководителя и инженера',table(['Данные','Решение','Проверка','Внедрение'],[['Объект, план, каталог, источники','Как есть / покупка / RaaS','Поток, очередь, деньги, ограничения','Измерительный пилот и отчёт']])+para('Ключевые выводы видны сразу; формулы, допущения, состав оборудования и телеметрия раскрываются по необходимости.')),
    slide(0,'Откуда берутся данные и балл',list(['База конкурса: ТЗ, каталог и цены ФЦ БАС. Производители/поставщики дополняют карточки с источниками; ручные оценки отмечены.','Жёсткие фильтры: объект, процесс, масса и габариты. Пробелы ТТХ отмечаются отдельно. Затем рассчитываются парк, зарядки и экономика.','Score = 100 × сумма нормированных взвешенных факторов: экономика, качество данных, зрелость, запас и кейсы.','Первый в рейтинге — финансовый кандидат. Физическая проверка потока и ограничения формируют отдельный вердикт.'])),
    slide(0,'Как результат проходит через систему',table(['Браузер','Сервер / PostgreSQL','Отдельный worker'],[['Параметры → заявка → статус','Принимает вход, хранит задание и снимок справочников','Считает экономику и каноническую пространственную модель'],['Результат / карта / отчёт','Атомарно публикует при актуальной revision','Heartbeat, бюджет, отмена и восстановление lease']])+para('Гостевое демо считает актуальный ввод через HTTP без долговременной очереди. Сохранённый архив читается по снимку, без тихого пересчёта.')),
    slide(4,'Два независимых основания доверия',table(['Финансовая привлекательность','Инженерная выполнимость'],[['CAPEX / OPEX / ROI / NPV / TCO','Плотный план / габариты / зарядка / конфликты'],['Денежная реализация труда отдельно','Завершённые доставки отдельно от начала работы'],['Источники, диапазоны и остаточная стоимость','OK / PARTIAL / FAIL / отсутствие измерения']])+para('Положительный NPV не превращает провал нагрузки в рекомендацию.')),
    slide(5,'Перевозится весь мобильный стеллаж',`<div class="visual-grid"><div>${list(['Подача → подхват → перевозка → установка → выезд.','После разгрузки - возврат пустого носителя с тем же ID.','Служебные подачи и возвраты не накручивают клиентский поток.'])}${para('Стеллаж 1,4 × 1,0 × 2,2 м, пять ярусов. Реконструкция по фото с явными допущениями.')}</div>${visual('warehouse-current.png',`Проектный просмотр N${fleet}/C${chargers}, ${versions.spatial}. Условный учебный склад, имитация.`)}</div>`),
    slide(6,'Модель можно разобрать во времени',`<div class="visual-grid"><div>${list(['Плотный план, конфликты и безопасный отход.','Клик по роботу: модель, задача, телеметрия.','История заданий и состояний; выбор момента.','×1 / ×5 / ×10 / ×50 / ×500 ускоряют воспроизведение.'])}</div>${visual('robot-current.png',`Модель и ретроспектива того же N${fleet}/C${chargers}-проекта. Расчётные данные, подключения к оборудованию нет.`)}</div>`),
    slide(7,'Найден проверяемый подходящий вариант',`<div class="metrics"><div><b>${fmt(q.achievedPerH)}</b><small>пал./ч при цели ${fmt(q.requiredPerH)}</small></div><div><b>${fleet} / ${chargers}</b><small>роботов / зарядок</small></div><div><b>${money(f.npvRub)}</b><small>NPV покупки</small></div></div>`+para(`OK / очередь ${q.queueEnd} / p95 ${fmt(q.waitP95Min)} мин. Реальный серверный прогон ${versions.spatial}, фиксированные вход и seed.`)+para(assumption)),
    slide(8,'Почему результаты сценариев различаются',proof+para('Двойная нагрузка и сохранённый персонал дают разные причины отказа. Физический статус и денежный результат показаны отдельно: один не подменяет другой.')),
    slide(9,'Пилот - часть результата',list(['Участок, состав, длительность и критерии успеха.','Подготовка сети, проходов, покрытия, доков, лифтов и питания.','Смета по статьям с источниками и неизвестными суммами.','Измерения → корректировка → решение о масштабировании.'])+para('Не обещаем мощность полного парка по тесту одного робота.')),
    slide(10,'Результат можно сохранить и защитить',list(['Worker-очередь переживает закрытие вкладки; есть отмена и история.','CALCULATE не публикует черновик; SAVE проверяет редакцию атомарно.','Поздний результат не переписывает новую редакцию или новые локальные правки.','Архив сохраняет прежние числа и версию. PDF / CSV / XLSX относятся к его снимку.'])),
    slide(11,'Границы заявлены открыто',list(['Склад - полный путь; аэропорт и медучреждение - параметры и решения, экономика/имитация прототипные.','Уборка - дополнительное демонстрационное направление.','Нет натурной калибровки, сертификации безопасности, DWG и промышленных интеграций.','Каталожные характеристики, сервис и коммерческие условия требуют проверки поставщиком.'])),
    slide(0,'Что развиваем после проверки',table(['Работает сейчас','Дальше'],[['Каталог, подбор, деньги и единая складская имитация','Натурная калибровка и несколько измерительных сценариев'],['План, телеметрия, ретроспектива и пилот','CAD со шкалой и проверкой проходимости'],['Durable worker, снимки, история и экспорт','Стенд WMS/ERP, мониторинг и эксплуатационный контур']])+para('Полные процессы аэропорта и медучреждения, промышленный CAD-импорт и реальные интеграции пока в плане развития.')) ,
    slide(12,'Что подтверждено перед показом',list([unitStatement(verification),verification.browser,'Границы отдельных проверок и версии перечислены в verification-review.json.',verification.database?.slideStatement??'Актуальный DB-прогон не заявлен; см. точные границы в verification-review.json'])+para('Доказательства ограничены локальным выпуском. Следующий шаг - обследование и измерительный пилот с заказчиком.')),
  ].join('');
  const slideCss = `${css}@page{size:320mm 180mm;margin:0}.slide{width:320mm;height:180mm;padding:14mm 18mm;position:relative;break-after:page;overflow:hidden}.slide:last-child{break-after:auto}.slide h1{font-size:30pt;margin:9mm 0}.slide p,.slide li{font-size:16pt;line-height:1.45}.slide li{margin:5mm 0}.slide table{font-size:12pt}.slide .kicker{font-size:10pt}.slide footer{position:absolute;left:18mm;right:18mm;bottom:8mm;border-top:1px solid #b6c9c6;padding-top:3mm;font:9pt Consolas;color:#516d72}.lead{font-size:24pt!important;margin-top:16mm!important}.stamp{border-left:5px solid #17696c;padding:5mm;margin-top:15mm;font:12pt Consolas}.metrics{display:flex;gap:9mm;margin:12mm 0}.metrics>div{flex:1;border-top:3px solid #17696c;padding-top:4mm}.metrics b{display:block;font-size:27pt;color:#17696c}.metrics small{display:block;font-size:12pt;margin-top:4mm}.visual-grid{display:grid;grid-template-columns:1fr 1.8fr;gap:8mm;align-items:start}.visual-grid li,.visual-grid p{font-size:13pt;margin:3mm 0}.visual-grid figure{margin:0}.visual-grid img{width:100%;max-height:99mm;object-fit:contain;object-position:top;border:1px solid #b6c9c6}.visual-grid figcaption{font-size:9pt;line-height:1.4;color:#516d72;margin-top:3mm}`;
  return { documentation: `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Платформа оценки роботизации - документация</title><style>${css}</style><body>${full}</body></html>`, presentation: `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Платформа оценки роботизации</title><style>${slideCss}</style><body>${slides}</body></html>` };
}

async function build() {
  const data = facts(), html = docs(data);
  const browser = await chromium.launch({ headless: true });
  const targets=process.argv[3]?[process.argv[3]]:['presentation','documentation'];
  if(targets.some(name=>!['presentation','documentation'].includes(name))) throw new Error('Build target must be presentation or documentation');
  try { for (const name of targets) {
    const page = await browser.newPage();
    await page.setContent(html[name], { waitUntil: 'networkidle' });
    const overflow = await page.locator(name === 'presentation' ? '.slide' : '.chapter').evaluateAll(nodes => nodes.map((node,index)=>({ page:index+1, overflow:node.scrollHeight > node.clientHeight+1, height:node.clientHeight, scroll:node.scrollHeight })).filter(n=>n.overflow));
    if (name === 'presentation' && overflow.length) throw new Error(`Slide clipping ${JSON.stringify(overflow)}`);
    await page.pdf({ path: path.join(OUT, `${name}.pdf`), printBackground: true, preferCSSPageSize: true,
      ...(name === 'documentation' ? { displayHeaderFooter:true, headerTemplate:'<span></span>', footerTemplate:'<div style="font:8px Arial;color:#516d72;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>Платформа оценки роботизации</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' } : {}) });
    await page.close();
  } } finally { await browser.close(); }
  const rows=data.examples.map(ex=>`| ${ex.id} | ${fmt(ex.spec.cashRealizationShare*100,0)}% | ${ex.evidence.simModelVersion} | ${ex.evidence.assessment.status} | ${fmt(ex.evidence.summary.achievedPerH)} / ${fmt(ex.evidence.summary.requiredPerH)} | ${ex.evidence.summary.queueEnd} | ${fmt(ex.evidence.summary.waitP95Min)} | ${money(ex.financial.npvRub)} |`).join('\n');
  const qualified=data.positive, fleet=qualified.financial.items[0].n, chargers=qualified.financial.items[0].chargers;
  const inputs=data.examples.map(ex=>({id:ex.id,params:ex.results.paramsUsed,cashRealizationShare:ex.spec.cashRealizationShare}));
  write('demo-numbers.md', `# Контрольные числа текущего выпуска\n\n${versionText(data.versions)}. Источники — реальные серверные receipts в этой папке.\n\n| Пример | Денежная реализация труда | Пространственная версия | Статус | Факт / цель, пал./ч | Очередь | p95 начала обработки, мин | NPV покупки |\n|---|---|---|---|---|---|---|---|\n${rows}\n\nКвалифицированный сохранённый парк N${fleet}/C${chargers}. Входы каждого примера, клиентские операции по типам и денежная реализация труда:\n\n\`\`\`json\n${JSON.stringify(inputs,null,2)}\n\`\`\`\n\nPDF/CSV/XLSX сняты с одного сохранённого worker-проекта ${data.source.project.id}, редакция ${data.source.project.revision}. Суммы округлены; JSON сохраняет точность. Это учебные данные, не измерения заказчика.\n`);
  const headings=sourceHtml=>[...sourceHtml.matchAll(/<h1>(.*?)<\/h1>/g)].map((match,index)=>({index:index+1,title:match[1]}));
  const structure={presentationSlides:(html.presentation.match(/class="slide"/g)||[]).length,documentationChapters:(html.documentation.match(/class="chapter(?: compact)?"/g)||[]).length,presentationContents:headings(html.presentation),documentationContents:headings(html.documentation)};
  write('content-coverage.json',JSON.stringify({scope:'Structural content mapping, not a claim of complete requirement acceptance; pages and independent review checked after rendering',versions:data.versions,structure,requirements:[
    {clause:'5.3',artifact:'presentation.pdf',sections:['Одних паспортных цифр недостаточно','Один путь для руководителя и инженера','Откуда берутся данные и балл','Как результат проходит через систему','Два независимых основания доверия','Перевозится весь мобильный стеллаж','Модель можно разобрать во времени','Границы заявлены открыто','Что развиваем после проверки']},
    {clause:'5.4–5.7',artifact:'documentation.pdf',sections:['Для кого и какой результат','Три воспроизводимых примера'],scope:'Repository DEMO-SCRIPT.md documents the full organizer-data journey and three-facility minimum. Current package examples are explicitly modified educational inputs; this mapping does not invent an E2E acceptance run.'},
    {clause:'6.1–6.3',artifact:'documentation.pdf',sections:['Для кого и какой результат','Сервер, очередь и целостность','Структура данных и API','Интерфейсы и администрирование','Воспроизведение и ограничения']},
    {clause:'6.4–6.5',artifact:'documentation.pdf',sections:['Каталог, данные и подбор','Деньги и физика отвечают на разные вопросы','Покупка, услуга и допущения','Полный транспортный цикл'],appendix:'sample-report.pdf: saved calculation trace and formula registry'},
    {clause:'6.6–6.7',artifact:'documentation.pdf',sections:['Руководства и изменение данных']},
    {clause:'6.8',artifact:'documentation.pdf',sections:['Источники и внешние библиотеки'],explicit:'Clickable library/vendor source URLs and linked repository provenance'},
    {clause:'6.9–6.10',artifact:'documentation.pdf',sections:['План развития и критерии перехода','Воспроизведение и ограничения','Три воспроизводимых примера']}
  ]},null,2));
  write('README.md', `# Текущий сдаточный комплект\n\n${data.date}: ${versionText(data.versions)}.\n\n- [presentation.pdf](./presentation.pdf) — ${structure.presentationSlides} слайдов продукта, алгоритма, источников, архитектуры и плана развития.\n- [documentation.pdf](./documentation.pdf) — руководство по функционалу, моделям, данным, архитектуре и запуску.\n- sample-report.pdf/csv/xlsx — реальные выгрузки сохранённого N${fleet}/C${chargers} проекта.\n- [calculation-source.json](./calculation-source.json) — вход, версия, операция и сохранённый результат.\n- Три *-receipt.json — реальные серверные ответы; [demo-numbers.md](./demo-numbers.md) содержит числа и допущения.\n- [content-coverage.json](./content-coverage.json) — карта обязательного содержания документов; не общий вердикт соответствия.\n- [release-manifest.json](./release-manifest.json) — SHA256 и границы приёмки.\n\nУчебные данные не являются коммерческими условиями заказчика. Локальная приёмка не означает обновление внешнего стенда. Документы на уровень выше архивные.\n`);
  console.log('Built current presentation, documentation and control numbers.');
}

function manifest() {
  const data = facts(), verification=read('verification-review.json'), coverage=read('content-coverage.json'), pdfQa=read('pdf-qa.json');
  if(verification.engineRelease!==data.source.operation.engineRelease) throw new Error('Verification fingerprint does not match the exported worker operation');
  if(JSON.stringify(verification.versions)!==JSON.stringify(data.versions)||JSON.stringify(coverage.versions)!==JSON.stringify(data.versions)) throw new Error('Package proof/content versions are stale');
  for(const name of ['presentation','documentation','sample-report']) {
    const actual=sha(path.join(OUT,`${name}.pdf`));
    if(pdfQa[name]?.sha256!==actual||pdfQa[name].blankPages.length||pdfQa[name].outsideBounds.length) throw new Error(`Missing/current PDF render QA: ${name}`);
    if(verification.pdfVisual?.finalProofPdfSha256?.[name]!==actual) throw new Error(`Independent visual proof must name the exact PDF SHA: ${name}`);
  }
  const walk=(directory,prefix='')=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name),`${prefix}${entry.name}/`):[`${prefix}${entry.name}`]);
  const files = walk(OUT).filter(name=>name !== 'release-manifest.json').map(name=>({ name, bytes:fs.statSync(path.join(OUT,name)).size, sha256:sha(path.join(OUT,name)) }));
  write('release-manifest.json', JSON.stringify({ schemaVersion:'submission-current-1', generatedAt:new Date().toISOString(), versions:data.versions, source:{ baseUrl:BASE, project:data.source.project, calculationOperation:data.source.operation, capturedAt:data.source.capturedAt, generatorSha256:sha(fileURLToPath(import.meta.url)) }, receipts:data.examples.map(example=>({ id:example.id, calculatedAt:example.results.calculatedAt, modelVersion:example.results.modelVersion, analyticalVersion:example.results.simModelVersion, spatialVersion:example.evidence.simModelVersion, dataVersion:example.results.dataVersion, cashRealizationShare:example.spec.cashRealizationShare, status:example.evidence.assessment.status })), claims:{ qualifiedExample:`Actual saved N${data.positive.financial.items[0].n}/C${data.positive.financial.items[0].chargers}; NPV > 0 and spatial OK`, otherExamples:data.examples.filter(example=>example.id!=='steady-flow').map(example=>({id:example.id,status:example.evidence.assessment.status,npvRub:example.financial.npvRub})), unit:unitStatement(read('verification-review.json')), database:read('verification-review.json').database.statement, browser:verification.browser, pilot:read('verification-review.json').pilot, externalDeployment:'Not certified updated', calibration:'Educational inputs and geometry; no industrial safety certification or natural-site calibration' }, contentCoverage:coverage, visualQa:pdfQa, review:verification, files }, null, 2));
  console.log(`Manifest: ${files.length} hashed files.`);
}
const command=process.argv[2];
(command==='capture'?capture():command==='receipts'?receipts():(command==='report'||command==='report-image')?report():command==='refresh'?refresh():command==='visuals'?visuals():command==='build'?build():command==='manifest'?Promise.resolve().then(manifest):command==='inspect'?Promise.resolve().then(()=>console.log(JSON.stringify({versions:localVersions(),libraries:packages()},null,2))):Promise.reject(new Error('Use capture | receipts | report | report-image | refresh | visuals | build | manifest | inspect'))).catch(error=>{console.error(error);process.exitCode=1;});
