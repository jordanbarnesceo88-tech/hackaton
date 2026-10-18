import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

if(process.argv.includes('--help')){console.log('Isolated local recovery check: QUEUE_LOAD_ISOLATED=1, QUEUE_LOAD_ORIGIN, DATABASE_URL, QUEUE_LOAD_PROJECT, QUEUE_LOAD_REPORT_DIR, QUEUE_LOAD_WORKERS (1..3). Requires an EMPTY dedicated queue. Creates one fixture CREATE, kills all worker containers in this project while it runs, waits for lease expiry and restarts the SAME containers. Verifies same input/job/run and exactly one project. Retains failed fixtures.');process.exit(0);}
assert.equal(process.env.QUEUE_LOAD_ISOLATED,'1');
const origin=new URL(process.env.QUEUE_LOAD_ORIGIN),database=new URL(process.env.DATABASE_URL);
for(const url of [origin,database])assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
assert.ok(['http:','https:'].includes(origin.protocol));
assert.equal(origin.pathname,'/');assert.equal(origin.username,'');assert.equal(origin.password,'');assert.equal(origin.search,'');assert.equal(origin.hash,'');
const base=origin.origin,project=process.env.QUEUE_LOAD_PROJECT;
assert.match(project??'',/^[a-z0-9][a-z0-9_-]+$/);
const workerCount=Number(process.env.QUEUE_LOAD_WORKERS||1);assert.ok(Number.isInteger(workerCount)&&workerCount>=1&&workerCount<=3);
const workers=Array.from({length:workerCount},(_,i)=>`${project}-worker-${i+1}`);
assert.ok(process.env.QUEUE_LOAD_REPORT_DIR);const directory=path.resolve(process.env.QUEUE_LOAD_REPORT_DIR);fs.mkdirSync(directory,{recursive:true});
const db=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const source=JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../docs/submission/current/calculation-source.json'),'utf8'));
const run=`queue-recovery-${Date.now()}`,id=crypto.randomUUID(),email=run+'@example.invalid',password=crypto.randomBytes(24).toString('hex');
const cookies=new Map(),report={run,base,scope:'Abrupt real process death on one isolated CREATE; no cancellation API, lease edits or synthetic compute.',workers,events:[],health:[],pass:false};
const save=()=>fs.writeFileSync(path.join(directory,'recovery-report.json'),JSON.stringify(report,null,2));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(route,init={}){const headers=new Headers(init.headers);headers.set('Origin',base);headers.set('x-forwarded-for',run);headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+route,{...init,headers,redirect:'manual',signal:AbortSignal.timeout(30000)});for(const c of r.headers.getSetCookie()){const pair=c.split(';',1)[0],eq=pair.indexOf('=');if(eq>0)cookies.set(pair.slice(0,eq),pair.slice(eq+1));}return r;}
async function state(jobId){const q=await db.query('SELECT j.*,r."inputHash",r."reservedProjectId",r."projectId",r."publicationState",r."publishedRevision",r."engineRelease",r.input,r.results FROM "CalculationJob" j JOIN "CalculationRun" r ON r.id=j."runId" WHERE j.id=$1 AND j."ownerId"=$2',[jobId,id]);assert.equal(q.rowCount,1);return q.rows[0];}
function summary(row){const {input,results,...rest}=row;return{...rest,inputBytes:Buffer.byteLength(JSON.stringify(input)),hasResult:results!==null};}
async function main(){let stopped=false;try{
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "CalculationJob" WHERE status IN (\'QUEUED\',\'RUNNING\')')).rows[0].n,0,'Dedicated contour must have no active work');
  report.imagesBefore=cp.execFileSync('docker',['inspect','--format','{{.Name}} {{.Image}}',...workers],{encoding:'utf8'}).trim().split(/\r?\n/);
  await db.query('INSERT INTO "User" (id,email,"passwordHash",name,"createdAt",role) VALUES ($1,$2,$3,$4,now(),\'USER\')',[id,email,await bcrypt.hash(password,10),run]);
  const csrf=await(await request('/api/auth/csrf')).json();
  assert.equal((await request('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({email,password,csrfToken:csrf.csrfToken,callbackUrl:base+'/projects'})})).status,200);
  assert.equal((await(await request('/api/auth/session')).json()).user?.id,id);
  const scenarios=structuredClone(source.submitted.scenarios);for(const s of scenarios)delete s.spatialEvidence;
  const payload={...source.submitted,operation:'CREATE',name:run,scenarios};
  const accepted=await request('/api/v1/calculation-jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':run},body:JSON.stringify(payload)});assert.equal(accepted.status,202);
  const job=(await accepted.json()).job;report.jobId=job.id;
  let initial;const claimDeadline=Date.now()+30000;
  do{initial=await state(job.id);if(initial.status==='RUNNING')break;assert.equal(initial.status,'QUEUED');await wait(50);}while(Date.now()<claimDeadline);
  assert.equal(initial.status,'RUNNING');assert.equal(initial.attempts,1);report.firstStartedAt=initial.startedAt;report.beforeKill=summary(initial);save();
  cp.execFileSync('docker',['kill','--signal','SIGKILL',...workers],{encoding:'utf8'});stopped=true;
  report.killedAt=new Date().toISOString();report.events.push({type:'workers-killed',at:report.killedAt});
  const afterKill=await state(job.id);assert.equal(afterKill.status,'RUNNING','Kill must land before computation finishes');report.afterKill=summary(afterKill);
  const leaseClock=async()=> (await db.query('SELECT clock_timestamp() AS "serverNow", "leaseUntil" AT TIME ZONE \'UTC\' AS "leaseExpiresAt", clock_timestamp() >= ("leaseUntil" AT TIME ZONE \'UTC\') + interval \'1 second\' AS expired FROM "CalculationJob" WHERE id=$1 AND "ownerId"=$2',[job.id,id])).rows[0];
  const expiryDeadline=performance.now()+60000;
  do{const started=performance.now();const h=await fetch(base+'/api/health',{signal:AbortSignal.timeout(5000)});const body=await h.json();report.health.push({ms:performance.now()-started,status:h.status,db:body.db});report.leaseClock=await leaseClock();save();if(report.leaseClock.expired)break;assert.ok(performance.now()<expiryDeadline,'Lease must expire within recovery check budget');await wait(500);}while(true);
  assert.equal(report.leaseClock.expired,true);assert.ok(report.health.length>0,'Health must be observed while workers are stopped');
  report.expiredBeforeRestart=summary(await state(job.id));assert.equal(report.expiredBeforeRestart.status,'RUNNING');assert.equal(report.expiredBeforeRestart.attempts,1);
  cp.execFileSync('docker',['start',...workers],{encoding:'utf8'});stopped=false;report.restartedAt=new Date().toISOString();report.events.push({type:'same-workers-restarted',at:report.restartedAt});
  const end=Date.now()+90000;let final;
  do{final=await state(job.id);report.events.push({at:new Date().toISOString(),status:final.status,attempts:final.attempts,stage:final.stage,diagnosticCode:final.diagnosticCode});save();if(['SUCCEEDED','FAILED','CANCELLED'].includes(final.status))break;await wait(200);}while(Date.now()<end);
  assert.equal(final.status,'SUCCEEDED');assert.equal(final.attempts,2);assert.equal(final.runId,initial.runId);assert.equal(final.inputHash,initial.inputHash);assert.deepEqual(final.input,initial.input);assert.equal(final.projectId,initial.reservedProjectId);assert.equal(final.publicationState,'PUBLISHED');assert.equal(final.publishedRevision,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "Project" WHERE "userId"=$1',[id])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "CalculationRun" WHERE "ownerId"=$1',[id])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "CalculationSubmission" WHERE "ownerId"=$1',[id])).rows[0].n,1);
  const response=await request('/api/v1/calculation-jobs/'+job.id+'/result');assert.equal(response.status,200);const result=await response.json();const evidence=result.results.scenarios.find(s=>s.key==='purchase').spatialEvidence;assert.equal(evidence.assessment.status,'OK');assert.equal(evidence.summary.fleet,6);assert.equal(evidence.summary.achievedPerH,52);
  report.afterRecovery=summary(final);report.exactlyOneProject=true;report.imagesAfter=cp.execFileSync('docker',['inspect','--format','{{.Name}} {{.Image}}',...workers],{encoding:'utf8'}).trim().split(/\r?\n/);assert.deepEqual(report.imagesAfter,report.imagesBefore);assert.ok(report.health.every(h=>h.status===200&&h.db));report.pass=true;report.finishedAt=new Date().toISOString();
 }catch(error){report.error=error.stack;process.exitCode=1;}
 finally{if(stopped)cp.execFileSync('docker',['start',...workers],{encoding:'utf8'});if(report.pass){await db.query('DELETE FROM "User" WHERE id=$1 AND name=$2',[id,run]);report.fixtureCleanup='deleted exact fixture user and cascade rows';}else report.fixtureCleanup='retained failed fixture';save();await db.end();console.log(JSON.stringify({pass:report.pass,jobId:report.jobId,beforeAttempts:report.beforeKill?.attempts,afterAttempts:report.afterRecovery?.attempts,exactlyOneProject:report.exactlyOneProject,error:report.error?.split('\n')[0]}));}
}
main();
