import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
if(process.argv.includes('--help')){console.log('Isolated local queue benchmark: set QUEUE_LOAD_ISOLATED=1, QUEUE_LOAD_ORIGIN, DATABASE_URL, QUEUE_LOAD_REPORT_DIR, QUEUE_LOAD_PROJECT and QUEUE_LOAD_WORKERS; run node scripts/check-queue-load.mjs. Creates 50 fixture users, authenticates them before timing, submits 50 real calculations without transport retries. Deletes only its own fixtures after PASS; retains them after FAIL. Requires PostgreSQL, Docker and the current submission reference.');process.exit(0);}
assert.equal(process.env.QUEUE_LOAD_ISOLATED,'1','Refusing load without explicit isolated-contour flag');
const origin=new URL(process.env.QUEUE_LOAD_ORIGIN);
const database=new URL(process.env.DATABASE_URL);
for(const u of [origin,database])assert.ok(['localhost','127.0.0.1','[::1]'].includes(u.hostname),'Only loopback contours are allowed');
assert.ok(['http:','https:'].includes(origin.protocol));
assert.equal(origin.pathname,'/');assert.equal(origin.search,'');assert.equal(origin.hash,'');assert.equal(origin.username,'');assert.equal(origin.password,'');
const base=origin.origin;
const project=process.env.QUEUE_LOAD_PROJECT;assert.match(project??'',/^[a-z0-9][a-z0-9_-]+$/);
const reportDir=path.resolve(process.env.QUEUE_LOAD_REPORT_DIR??'');assert.ok(process.env.QUEUE_LOAD_REPORT_DIR,'Explicit report directory required');fs.mkdirSync(reportDir,{recursive:true});
const db=new Pool({connectionString:process.env.DATABASE_URL,max:4});
const reference=JSON.parse(fs.readFileSync(path.join(scriptDir,'../docs/submission/current/calculation-source.json'),'utf8'));
const scenarios=structuredClone(reference.submitted.scenarios);for(const s of scenarios)delete s.spatialEvidence;
const input={operation:'CALCULATE',facility:'warehouse',params:reference.submitted.params,scenarios};
const run='queue-load-'+Date.now(), password=crypto.randomBytes(24).toString('hex');
const label=process.env.QUEUE_LOAD_LABEL||'fixed-one-worker';assert.match(label,/^[a-z0-9-]+$/);
const out={run,startedAt:new Date().toISOString(),base,dbPort:Number(database.port),sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDiffSha256:crypto.createHash('sha256').update(cp.execFileSync('git',['diff','HEAD'],{maxBuffer:20e6})).digest('hex'),scope:'50 distinct authenticated HTTP users, one simultaneous real full-horizon CALCULATE per user; one deployed worker process. Session setup excluded. No browser-render or 50-CPU-concurrency claim.',hardware:{cpu:os.cpus()[0].model,logicalCpu:os.cpus().length,ramBytes:os.totalmem(),sameHostClient:true},users:50,workerProcesses:1,criteria:{firstPostAccepted:50,unexpected5xx:0,lostJobs:0,maxValidLeases:2,allSucceeded:true,healthError:0},requests:[],jobs:[],health:[],monitor:[],errors:[]};
out.workerProcesses=Number(process.env.QUEUE_LOAD_WORKERS||1);assert.ok(Number.isInteger(out.workerProcesses)&&out.workerProcesses>=1&&out.workerProcesses<=3);out.scope=out.scope.replace('one deployed worker process',out.workerProcesses+' deployed worker processes');
out.criteria={...out.criteria,unexpectedRetries:0,postP95MaxMs:10000,postMaxMs:30000,healthP95MaxMs:1000,healthMaxMs:3000,pollP95MaxMs:1000,pollMaxMs:3000};
out.criteriaNote='Latency targets declared before fixed run are local engineering targets, not an asserted hackathon SLA. Original baseline remains a failed run.';
out.pollSamples=[];out.images=cp.execFileSync('docker',['inspect','--format','{{.Name}} {{.Image}}',...['app-1',...Array.from({length:out.workerProcesses},(_,i)=>'worker-'+(i+1))].map(s=>project+'-'+s)],{encoding:'utf8'}).trim().split(/\r?\n/);
const report=path.join(reportDir,label+'-report.json');
const save=()=>fs.writeFileSync(report,JSON.stringify(out,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.ceil(a.length*p)-1]:null};
const stat=values=>({p50:percentile(values,.5),p95:percentile(values,.95),max:percentile(values,1)});
async function client(index,id){
  const email=`${run}-${index}@example.invalid`,cookies=new Map();
  const request=async(route,init={})=>{const h=new Headers(init.headers);h.set('Origin',base);h.set('x-forwarded-for',`${run}-${index}`);h.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+route,{...init,headers:h,redirect:'manual',signal:AbortSignal.timeout(30000)});for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';',1)[0],eq=pair.indexOf('=');if(eq>0)cookies.set(pair.slice(0,eq),pair.slice(eq+1));}return r;};
  const csrf=await(await request('/api/auth/csrf')).json();assert.equal(typeof csrf.csrfToken,'string');
  const login=await request('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({email,password,csrfToken:csrf.csrfToken,callbackUrl:base+'/projects'})});assert.equal(login.status,200);
  const session=await(await request('/api/auth/session')).json();assert.equal(session.user?.id,id);
  return{index,id,email,request};
}
function financialSignature(results){return results.results.map(r=>({key:r.key,status:r.status,npvRub:r.npvRub,tcoRub:r.tcoRub,capexRub:r.capexRub,items:r.items?.map(i=>({n:i.n,chargers:i.chargers}))}));}
async function main(){
 let monitoring=true, monitor;
 const ids=Array.from({length:50},()=>crypto.randomUUID());
 try{
  const health=await(await fetch(base+'/api/health')).json();assert.equal(health.db,true);assert.equal(health.modelVersion,'tz-1.0.6');
  const current=await db.query('SELECT count(*)::int AS n FROM "CalculationJob" WHERE status IN (\'QUEUED\',\'RUNNING\')');assert.equal(current.rows[0].n,0,'Load contour must start empty');
  const hash=await bcrypt.hash(password,10);
  for(let i=0;i<ids.length;i++)await db.query('INSERT INTO "User" (id,email,"passwordHash",name,"createdAt",role) VALUES ($1,$2,$3,$4,now(),\'USER\')',[ids[i],`${run}-${i}@example.invalid`,hash,run]);
  const clients=[];for(let start=0;start<50;start+=5)clients.push(...await Promise.all(ids.slice(start,start+5).map((id,i)=>client(start+i,id))));
  out.authenticatedUsers=clients.length;out.setupFinishedAt=new Date().toISOString();save();
  monitor=Promise.all([
    (async()=>{while(monitoring){const start=performance.now();try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(10000)});const h=await r.json();out.health.push({at:new Date().toISOString(),ms:performance.now()-start,status:r.status,db:h.db});}catch(e){out.health.push({at:new Date().toISOString(),ms:performance.now()-start,error:e.message});}await wait(Math.max(0,1000-(performance.now()-start)));}})(),
    (async()=>{while(monitoring){const start=performance.now();try{const q=await db.query('SELECT status,count(*)::int AS n,count(*) FILTER (WHERE "leaseUntil">clock_timestamp())::int AS valid FROM "CalculationJob" WHERE "ownerId"=ANY($1::text[]) GROUP BY status',[ids]);out.monitor.push({at:new Date().toISOString(),states:q.rows});}catch(e){out.errors.push('DB monitor: '+e.message);}save();await wait(Math.max(0,250-(performance.now()-start)));}})()
  ]);
  const barrier=performance.now();out.burstAt=new Date().toISOString();
  await Promise.all(clients.map(async c=>{const started=performance.now(),key=run+':'+c.index;const row={index:c.index,ownerId:c.id,idempotencyKey:key,startSkewMs:started-barrier,clientPostStartMonoMs:started};out.requests.push(row);try{const r=await c.request('/api/v1/calculation-jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(input)});row.ms=performance.now()-started;row.status=r.status;const body=await r.json();if(r.status===202){row.jobId=body.job.id;row.runId=body.job.runId;}else row.error=body.error??'Unexpected response';}catch(e){row.ms=performance.now()-started;row.error=e.message;}}));
  out.accepted=out.requests.filter(r=>r.status===202).length;out.admissionMs=stat(out.requests.map(r=>r.ms));save();console.log(JSON.stringify({phase:'admission',accepted:out.accepted,total:50,statuses:out.requests.reduce((a,r)=>(a[r.status??'error']=(a[r.status??'error']??0)+1,a),{}),ms:out.admissionMs}));
  out.idempotency=[];
  for(const row of out.requests.filter(r=>r.jobId).slice(0,10)){const r=await clients[row.index].request('/api/v1/calculation-jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':row.idempotencyKey},body:JSON.stringify(input)});const body=await r.json();out.idempotency.push({status:r.status,sameJob:body.job?.id===row.jobId,sameRun:body.job?.runId===row.runId});}
  if(out.requests.some(r=>r.jobId)){const row=out.requests.find(r=>r.jobId),changed=structuredClone(input);changed.params.forkliftSalaryRubMonth+=1;const conflict=await clients[row.index].request('/api/v1/calculation-jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':row.idempotencyKey},body:JSON.stringify(changed)});const foreign=await clients[(row.index+1)%50].request('/api/v1/calculation-jobs/'+row.jobId);out.negativeControls={changedPayloadStatus:conflict.status,foreignJobStatus:foreign.status};}
  const pending=new Map(out.requests.filter(r=>r.jobId).map(r=>[r.jobId,r]));const deadline=Date.now()+10*60000;
  while(pending.size&&Date.now()<deadline){await Promise.all([...pending].map(async([id,row])=>{const c=clients[row.index];try{const started=performance.now(),response=await c.request('/api/v1/calculation-jobs/'+id);const body=await response.json();out.pollSamples.push({ms:performance.now()-started,status:response.status});if(response.status!==200){out.errors.push(`Poll ${id}: HTTP${response.status}`);return;}if(['SUCCEEDED','FAILED','CANCELLED'].includes(body.job.status)){row.clientObservedEndToEndMs=performance.now()-row.clientPostStartMonoMs;out.jobs.push(body.job);pending.delete(id);}}catch(e){out.errors.push('Poll: '+e.message);}}));save();if(pending.size)await wait(1000);}
  out.unfinished=[...pending.keys()];
  for(const job of out.jobs){if(job.status!=='SUCCEEDED')continue;const row=out.requests.find(r=>r.jobId===job.id),c=clients[row.index];const response=await c.request('/api/v1/calculation-jobs/'+job.id+'/result');assert.equal(response.status,200);const result=await response.json();assert.equal(result.job.publicationState,'NONE');assert.deepEqual(financialSignature(result.results),financialSignature(reference.results));const purchase=result.results.scenarios.find(s=>s.key==='purchase');assert.equal(purchase.spatialEvidence.assessment.status,'OK');assert.equal(purchase.spatialEvidence.summary.fleet,6);assert.equal(purchase.spatialEvidence.summary.achievedPerH,52);assert.equal(purchase.spatialEvidence.summary.queueEnd,2);row.resultVerified=true;row.engineRelease=job.engineRelease;}
  const persisted=await db.query('SELECT count(*)::int AS jobs,count(DISTINCT "runId")::int AS runs FROM "CalculationJob" WHERE "ownerId"=ANY($1::text[])',[ids]);out.persisted=persisted.rows[0];
  monitoring=false;await monitor;
  out.summary={accepted:out.accepted,succeeded:out.jobs.filter(j=>j.status==='SUCCEEDED').length,verified:out.requests.filter(r=>r.resultVerified).length,statuses:out.jobs.reduce((a,j)=>(a[j.status]=(a[j.status]??0)+1,a),{}),attemptCounts:out.jobs.reduce((a,j)=>(a[j.attempts]=(a[j.attempts]??0)+1,a),{}),queueWaitMs:stat(out.jobs.filter(j=>j.attempts===1).map(j=>Date.parse(j.startedAt)-Date.parse(j.createdAt))),computeAndStoreMs:stat(out.jobs.filter(j=>j.attempts===1).map(j=>Date.parse(j.finishedAt)-Date.parse(j.startedAt))),serverCreatedToFinishedMs:stat(out.jobs.map(j=>Date.parse(j.finishedAt)-Date.parse(j.createdAt))),clientObservedEndToEndMs:stat(out.requests.map(r=>r.clientObservedEndToEndMs)),pollMs:stat(out.pollSamples.map(p=>p.ms)),healthMs:stat(out.health.map(h=>h.ms)),healthErrors:out.health.filter(h=>h.status!==200||!h.db).length,maxValidLeases:Math.max(0,...out.monitor.map(m=>m.states.filter(s=>s.status==='RUNNING').reduce((n,s)=>n+s.valid,0)))};
  out.pass=out.accepted===50&&out.summary.succeeded===50&&out.summary.verified===50&&!out.unfinished.length&&out.summary.healthErrors===0&&out.summary.maxValidLeases===Math.min(out.workerProcesses,2)&&out.errors.length===0&&out.persisted.jobs===50&&out.persisted.runs===50&&out.jobs.every(j=>j.attempts===1)&&out.idempotency.every(r=>r.status===202&&r.sameJob&&r.sameRun)&&out.negativeControls?.changedPayloadStatus===409&&out.negativeControls?.foreignJobStatus===404&&out.admissionMs.p95<=10000&&out.admissionMs.max<30000&&out.summary.pollMs.p95<=1000&&out.summary.pollMs.max<3000&&out.summary.healthMs.p95<=1000&&out.summary.healthMs.max<3000;
  out.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({pass:out.pass,summary:out.summary}));if(!out.pass)process.exitCode=1;
 }catch(e){out.failure=e.stack;out.pass=false;save();console.error(e.message);process.exitCode=1;}
 finally{monitoring=false;await monitor;const active=await db.query('SELECT count(*)::int AS n FROM "CalculationJob" WHERE "ownerId"=ANY($1::text[]) AND status IN (\'QUEUED\',\'RUNNING\')',[ids]);if(active.rows[0].n===0&&out.pass){await db.query('DELETE FROM "User" WHERE id=ANY($1::text[]) AND name=$2',[ids,run]);out.fixtureCleanup='deleted exact 50 owned fixture users and cascade rows';}else out.fixtureCleanup='retained failed or active fixtures for diagnosis';save();await db.end();}
}
main();
