import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canonicalJson, assertQualifiedCapacity } from './submission-capacity-contract.mjs';
import { assertIsolatedDatabase } from './queue-load/isolation.mjs';
import { resourceLimits } from './queue-load/benchmark-contract.mjs';
import { CONTOUR, parseDeclaredWorkers, sha, workerNames, containerSuffixes, assertQueuePolicy, assertWorkerStartup, assertProfile, assertCanonicalCase, sourceGraph, declaredResources, businessSignature, catalogueSignature, assertExternalReportDirectory, serviceNetwork, assertServiceTopology, assertServiceNames, assertAppPort } from './queue-load/declaration.mjs';

const script = fileURLToPath(import.meta.url), repo = path.resolve(path.dirname(script), '..');
const require = createRequire(path.join(repo, 'package.json'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeError = error => ({ name: error?.name ?? 'Error', code: error?.code ?? null });
let preflightEvidence = null;

// Pure guards; importing this module never connects or invokes Docker.
export function recoveryRoute(env) {
  assert.equal(env.QUEUE_RECOVERY_GO, 'RUN', 'Explicit coordinator recovery GO required');
  const workers = parseDeclaredWorkers(env.QUEUE_LOAD_WORKERS);
  assert.equal(env.QUEUE_LOAD_PROJECT, CONTOUR.project);
  assert.equal(new URL(env.QUEUE_LOAD_ORIGIN ?? '').href, CONTOUR.origin + '/');
  assertIsolatedDatabase(env.DATABASE_URL);
  assert.match(env.QUEUE_LOAD_EXPECT_ENGINE ?? '', /^alfa-robot\/sha256:[a-f0-9]{64}$/);
  assert.ok(env.QUEUE_LOAD_EXPECT_JOB_ENGINE?.startsWith(env.QUEUE_LOAD_EXPECT_ENGINE + '/') && env.QUEUE_LOAD_EXPECT_JOB_ENGINE.length > env.QUEUE_LOAD_EXPECT_ENGINE.length + 1);
  for (const key of ['QUEUE_LOAD_EXPECT_APP_IMAGE','QUEUE_LOAD_EXPECT_WORKER_IMAGE']) assert.match(env[key] ?? '', /^sha256:[a-f0-9]{64}$/);
  return { project: CONTOUR.project, origin: CONTOUR.origin, workerCount: workers, workers: workerNames(workers) };
}

export function assertLoadReference(load, fixed, reference, profile, pins, workers) {
  workerNames(workers);
  assert.equal(load.schema, 'stage3-load-result-1');
  assert.ok(['PASS','FAIL'].includes(load.status), 'Load run must be finished; recovery never changes its SLA verdict');
  assert.equal(load.configuration.project, CONTOUR.project);
  assert.deepEqual([load.configuration.httpPort,load.configuration.dbPort,load.configuration.database,load.configuration.workers,load.configuration.globalLeaseCap,load.configuration.workerPoolMax], [3087,55440,'alfa_queue_scaled',workers,workers,2]);
  assert.equal(load.configuration.engine, pins.engine); assert.equal(load.configuration.jobEngine, pins.jobEngine);
  assert.deepEqual(load.configuration.images, pins.images);
  assert.equal(load.configuration.profileSha256, pins.profile); assert.equal(load.configuration.declaredResourcesSha256, pins.resources);
  assert.equal(load.configuration.requestSha256, sha(canonicalJson(fixed)));
  assert.equal(fixed.operation, 'CALCULATE'); assert.equal(fixed.facility, 'warehouse');
  assert.deepEqual(fixed.params, profile.initial.params);
  const phases=load.phases.filter(row=>row.name==='reference'); assert.equal(phases.length,1);
  const phase=phases[0]; assert.equal(phase.functionalPass,true); assert.equal(phase.compute60Pass,true); assert.equal(phase.requests.length,1);
  const row=phase.requests[0]; assert.equal(row.verified,true); assert.equal(row.verification.sha256,sha(pins.referenceBytes));
  assert.equal(reference.job.id,row.jobId); assert.equal(reference.job.runId,row.runId);
  assert.equal(reference.job.status,'SUCCEEDED'); assert.equal(reference.job.attempts,1);
  assert.equal(reference.job.publicationState,'NONE'); assert.equal(reference.job.engineRelease,pins.jobEngine);
  const verified=assertQualifiedCapacity(reference.results,profile.versions); assertCanonicalCase(verified,profile);
  return verified;
}

export function assertCreateFrozen(frozen,fixed,profile,name) {
  assert.equal(frozen.schemaVersion,1); assert.equal(frozen.operation,'CREATE');
  assert.equal(frozen.input.facility,fixed.facility); assert.deepEqual(frozen.input.params,fixed.params); assert.deepEqual(frozen.input.scenarios,fixed.scenarios);
  assert.equal(catalogueSignature(frozen.live),profile.catalogueSha256);
  assert.equal(frozen.publication.name,name); assert.match(frozen.publication.reservedProjectId??'',/^[a-f0-9-]{36}$/);
}

export function assertRecoveryIdentity(initial,final,owner) {
  assert.equal(initial.status,'RUNNING'); assert.equal(initial.attempts,1);
  assert.equal(final.status,'SUCCEEDED'); assert.equal(final.attempts,2);
  for(const key of ['id','runId','ownerId','inputHash','engineRelease','reservedProjectId'])assert.equal(final[key],initial[key],'Recovery changed '+key);
  assert.equal(final.ownerId,owner); assert.deepEqual(final.input,initial.input);
  assert.equal(sha(canonicalJson(final.input)),final.inputHash,'Hash differs from actual frozen input');
  assert.equal(final.projectId,initial.reservedProjectId); assert.equal(final.publicationState,'PUBLISHED'); assert.equal(final.publishedRevision,0);
  assert.equal(final.leaseToken,null); assert.equal(final.leaseUntil,null); assert.equal(final.cancelRequestedAt,null);
}

export function assertKillTargets(rows, workers) {
  assert.deepEqual(rows.map(row=>row.name),workerNames(workers),'All and only the declared workers may be killed');
  const ids=rows.map(row=>row.id);assert.equal(new Set(ids).size,workers);
  for(const id of ids)assert.match(id,/^[a-f0-9]{64}$/,'Only immutable full container IDs are allowed');
  return ids;
}

export function assertRestartIdentity(before,after,workers) {
  assertKillTargets(before,workers);assertKillTargets(after,workers);
  const stable=rows=>rows.map(({startedAt,network,...row})=>{void startedAt;return {...row,...(network?{network:{name:network.name,id:network.id,aliases:network.aliases}}:{})};});
  assert.deepEqual(stable(after),stable(before),'Restart changed container IDs, image, engine or resources');
  assert.ok(after.every((row,index)=>row.startedAt!==before[index].startedAt),'Every killed worker must restart');
}

export function attachRecoveryPoolErrors(db,report,save,onFatal=()=>{}) {
  report.databasePoolErrors=[];
  db.on('error',error=>{
    report.databasePoolErrors.push(safeError(error));report.pass=false;report.status='FAIL';
    save();onFatal();
  });
  return ()=>assert.equal(report.databasePoolErrors.length,0,'Database pool lost an idle connection; recovery evidence is invalid');
}

async function main() {
  if(process.argv.includes('--help')) {
    console.log('Guarded stage3 recovery: QUEUE_RECOVERY_GO=RUN; fixed project alfa-queue-scaled-20261019 HTTP3087/DB55440 alfa_queue_scaled; explicit QUEUE_LOAD_WORKERS=12 or14/matching-cap/pool2. Same image/engine/profile/resources declarations as queue-load/run.mjs, plus QUEUE_RECOVERY_LOAD_DIR, QUEUE_RECOVERY_EXPECT_LOAD_REPORT_SHA256 and new QUEUE_RECOVERY_REPORT_DIR. One real CREATE from pinned fixed-request.json; SIGKILL only declared verified IDs after attempt1 RUNNING; SQL-clock expiry; start SAME containers; attempt2/exactly-one publication verified. No lease edits, retries, scaling, fixture deletion or SLA promotion. See scripts/queue-load/RECOVERY.md.');return;
  }
  const env=process.env,route=recoveryRoute(env),workers=route.workerCount;
  const readPinned=(filename,expected)=>{assert.match(expected??'',/^[a-f0-9]{64}$/);const bytes=fs.readFileSync(filename);assert.equal(sha(bytes),expected,'Pinned file changed');return bytes;};
  const profilePath=path.resolve(env.QUEUE_LOAD_PROFILE??''),resourcesPath=path.resolve(env.QUEUE_LOAD_EXPECT_RESOURCES_FILE??'');
  const profileBytes=readPinned(profilePath,env.QUEUE_LOAD_EXPECT_PROFILE_SHA256),resourceBytes=readPinned(resourcesPath,env.QUEUE_LOAD_EXPECT_RESOURCES_SHA256);
  const profile=JSON.parse(profileBytes),resources=JSON.parse(resourceBytes);assertProfile(profile);
  assert.ok(env.QUEUE_RECOVERY_LOAD_DIR&&env.QUEUE_RECOVERY_REPORT_DIR);
  const loadDir=path.resolve(env.QUEUE_RECOVERY_LOAD_DIR),dir=path.resolve(env.QUEUE_RECOVERY_REPORT_DIR);
  assertExternalReportDirectory(repo,loadDir);assertExternalReportDirectory(repo,dir);assert.notEqual(dir,loadDir);
  assert.ok(!fs.existsSync(dir)||fs.readdirSync(dir).length===0,'Fresh empty recovery evidence directory required');
  const loadBytes=readPinned(path.join(loadDir,'report.json'),env.QUEUE_RECOVERY_EXPECT_LOAD_REPORT_SHA256),load=JSON.parse(loadBytes);
  const fixedBytes=readPinned(path.join(loadDir,'fixed-request.json'),load.configuration.requestFileSha256),fixed=JSON.parse(fixedBytes);
  const referenceFile=load.phases?.find(phase=>phase.name==='reference')?.requests?.[0]?.verification?.file;
  assert.ok(typeof referenceFile==='string'&&path.basename(referenceFile)===referenceFile,'Reference file must remain inside the declared load directory');
  const referenceBytes=fs.readFileSync(path.join(loadDir,referenceFile)),reference=JSON.parse(referenceBytes);
  const pins={engine:env.QUEUE_LOAD_EXPECT_ENGINE,jobEngine:env.QUEUE_LOAD_EXPECT_JOB_ENGINE,images:{app:env.QUEUE_LOAD_EXPECT_APP_IMAGE,worker:env.QUEUE_LOAD_EXPECT_WORKER_IMAGE},profile:sha(profileBytes),resources:sha(resourceBytes),referenceBytes};
  assertLoadReference(load,fixed,reference,profile,pins,workers);
  const graph=sourceGraph(repo,pins.engine);
  const files=[script,...['isolation.mjs','declaration.mjs','benchmark-contract.mjs'].map(name=>path.join(repo,'scripts/queue-load',name)),path.join(repo,'scripts/submission-capacity-contract.mjs'),profilePath,resourcesPath,path.join(loadDir,'report.json'),path.join(loadDir,'fixed-request.json'),path.join(loadDir,referenceFile)];
  const filePins=()=>files.map(filename=>({name:path.basename(filename),sha256:sha(fs.readFileSync(filename))})),pinsBefore=filePins();
  fs.mkdirSync(dir,{recursive:true});const run='stage3-recovery-'+Date.now(),owner=crypto.randomUUID();
  fs.writeFileSync(path.join(dir,'run-owner.json'),JSON.stringify({run,createdAt:new Date().toISOString()}),{flag:'wx'});
  const report={schema:'stage3-recovery-result-1',run,status:'PREFLIGHT',pass:false,scope:'One real CREATE and abrupt death of all declared workers; no industrial calibration, whole-product acceptance or client SLA claim.',configuration:{...route,globalCap:workers,workerPoolMax:2,engine:pins.engine,jobEngine:pins.jobEngine,images:pins.images,versions:profile.versions,filePins:pinsBefore,sourceGraph:graph},events:[],health:[],fixtureCleanup:'retained exact synthetic fixture; no DELETE or cancellation'};
  const save=()=>fs.writeFileSync(path.join(dir,'recovery-report.json'),JSON.stringify(report,null,2));
  preflightEvidence={report,save};save();
  const docker=args=>cp.execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:5e6,stdio:['ignore','pipe','pipe']}),dockerJson=args=>JSON.parse(docker(args));
  const host=()=>({cpuModel:os.cpus()[0]?.model,logicalCpu:os.cpus().length,ramBytes:os.totalmem()});
  const dockerHost=()=>{const row=dockerJson(['info','--format','{{json .}}']);return{cpus:row.NCPU,memoryBytes:row.MemTotal};};
  const hostBefore=host(),dockerBefore=dockerHost();declaredResources(resources,hostBefore,dockerBefore,workers);
  const inspect=(suffix,running=true)=>{
    const name=CONTOUR.project+'-'+suffix,row=dockerJson(['inspect',name])[0],worker=suffix.startsWith('worker');
    assert.equal(row.Name,'/'+name);assert.equal(row.State.Running,running);
    assert.equal(row.Config.Labels['com.docker.compose.project'],CONTOUR.project);assert.equal(row.Config.Labels['com.docker.compose.service'],worker?'worker':'app');
    assert.equal(row.Image,worker?pins.images.worker:pins.images.app);assert.deepEqual(resourceLimits(row),resources.containers[name]);
    if(!worker)assertAppPort(row);
    const network=serviceNetwork(row);
    const dbUrl=new URL((row.Config.Env.find(value=>value.startsWith('DATABASE_URL='))??'').slice('DATABASE_URL='.length));
    assert.equal(dbUrl.hostname,'db');assert.equal(dbUrl.port,'5432');assert.equal(dbUrl.pathname,'/'+CONTOUR.database);assert.equal(dbUrl.search+dbUrl.hash,'');
    const label=(row.Config.Env.find(value=>value.startsWith('CALCULATION_ENGINE_RELEASE='))??'').slice('CALCULATION_ENGINE_RELEASE='.length).trim();assert.equal(label?pins.engine+'/'+label:pins.engine,pins.jobEngine);
    if(running){const embedded=dockerJson(['exec',row.Id,'cat','/app/dist-worker/engine-release.json']);assert.equal(embedded.engineRelease,pins.engine);assert.equal(sha(canonicalJson(embedded)),sha(canonicalJson(JSON.parse(fs.readFileSync(path.join(repo,'dist-worker/engine-release.json'))))));if(worker)assertWorkerStartup(docker(['logs','--since',row.State.StartedAt,row.Id]),pins.jobEngine,workers);}
    return{name,id:row.Id,image:row.Image,startedAt:row.State.StartedAt,limits:resourceLimits(row),engine:pins.engine,jobEngine:pins.jobEngine,network};
  };
  const inspectWorkers=()=>{const names=service=>docker(['ps','--filter',`label=com.docker.compose.project=${CONTOUR.project}`,'--filter',`label=com.docker.compose.service=${service}`,'--format','{{.Names}}']).trim().split(/\r?\n/).filter(Boolean);assertServiceNames(names('app'),names('worker'),workers);};
  const inspectDb=()=>{const name=CONTOUR.project+'-db-1',row=dockerJson(['inspect',name])[0];assert.equal(row.State.Running,true);assert.equal(row.Config.Labels['com.docker.compose.project'],CONTOUR.project);assert.equal(row.Config.Labels['com.docker.compose.service'],'db');assert.equal(row.Image,resources.database.image);assert.deepEqual(resourceLimits(row),resources.database.limits);assert.ok(row.NetworkSettings.Ports['5432/tcp'].some(binding=>binding.HostIp==='127.0.0.1'&&binding.HostPort==='55440'));return{name,id:row.Id,image:row.Image,startedAt:row.State.StartedAt,limits:resourceLimits(row),network:serviceNetwork(row)};};
  const topology=(containers,database)=>assertServiceTopology(containers,database,dockerJson(['network','inspect',database.network.id])[0]);
  report.containersBefore=containerSuffixes(workers).map(suffix=>inspect(suffix));inspectWorkers();report.databaseContainerBefore=inspectDb();report.networkBefore=topology(report.containersBefore,report.databaseContainerBefore);
  const initialWorkers=report.containersBefore.filter(row=>row.name.includes('-worker-')),ids=assertKillTargets(initialWorkers,workers);
  const {Pool}=require('pg'),bcrypt=require('bcryptjs'),db=new Pool({connectionString:env.DATABASE_URL,max:2,statement_timeout:10000});
  const assertPoolHealthy=attachRecoveryPoolErrors(db,report,save,()=>{process.exitCode=1;});
  const cookies=new Map(),password=crypto.randomBytes(32).toString('hex'),email=run+'@example.invalid';let stopped=false;
  const request=async(route,init={})=>{const headers=new Headers(init.headers);headers.set('Origin',CONTOUR.origin);headers.set('x-forwarded-for',run);headers.set('Cookie',[...cookies].map(([key,value])=>key+'='+value).join('; '));const response=await fetch(CONTOUR.origin+route,{...init,headers,redirect:'manual',signal:AbortSignal.timeout(30000)});for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';',1)[0],eq=pair.indexOf('=');if(eq>0)cookies.set(pair.slice(0,eq),pair.slice(eq+1));}return response;};
  const policy=async()=>assertQueuePolicy((await db.query('SELECT id,"maxActive" FROM "CalculationQueuePolicy" ORDER BY id')).rows,workers);
  const identity=async()=>(await db.query('SELECT current_database() AS database,pg_postmaster_start_time() AS "startedAt"')).rows[0];
  const state=async id=>{const q=await db.query('SELECT j.*,r."inputHash",r."reservedProjectId",r."projectId",r."publicationState",r."publishedRevision",r."engineRelease",r.input,r.results FROM "CalculationJob" j JOIN "CalculationRun" r ON r.id=j."runId" WHERE j.id=$1 AND j."ownerId"=$2 AND r."ownerId"=$2',[id,owner]);assert.equal(q.rowCount,1);return q.rows[0];};
  const brief=row=>{const {input,results,...rest}=row;return{...rest,inputSha256:sha(canonicalJson(input)),hasResults:results!==null};};
  try{
    report.databaseBefore=await identity();assert.equal(report.databaseBefore.database,CONTOUR.database);report.policyBefore=await policy();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "CalculationJob" WHERE status IN (\'QUEUED\',\'RUNNING\')')).rows[0].n,0,'Dedicated queue must be empty');
    await db.query('INSERT INTO "User" (id,email,"passwordHash",name,"createdAt",role) VALUES ($1,$2,$3,$4,now(),\'USER\')',[owner,email,await bcrypt.hash(password,10),run]);report.fixtureOwner=owner;save();
    const csrfResponse=await request('/api/auth/csrf');assert.equal(csrfResponse.status,200);const csrf=await csrfResponse.json();
    assert.equal((await request('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({email,password,csrfToken:csrf.csrfToken,callbackUrl:CONTOUR.origin+'/projects'})})).status,200);
    assert.equal((await(await request('/api/auth/session')).json()).user?.id,owner);
    const payload={...fixed,operation:'CREATE',name:run};fs.writeFileSync(path.join(dir,'create-request.json'),JSON.stringify(payload,null,2),{flag:'wx'});report.createRequestSha256=sha(canonicalJson(payload));
    const accepted=await request('/api/v1/calculation-jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':run},body:JSON.stringify(payload)});report.admissionStatus=accepted.status;assert.equal(accepted.status,202);const receipt=await accepted.json();assert.equal(receipt.job.engineRelease,pins.jobEngine);report.jobId=receipt.job.id;report.runId=receipt.job.runId;
    let initial;const claimDeadline=performance.now()+30000;do{initial=await state(report.jobId);if(initial.status==='RUNNING')break;assert.equal(initial.status,'QUEUED');assert.ok(performance.now()<claimDeadline,'Claim deadline');await sleep(25);}while(true);
    assert.equal(initial.attempts,1);assert.equal(initial.runId,report.runId);assertCreateFrozen(initial.input,fixed,profile,run);assert.equal(sha(canonicalJson(initial.input)),initial.inputHash);
    fs.writeFileSync(path.join(dir,'frozen-input.json'),JSON.stringify(initial.input,null,2),{flag:'wx'});report.frozenInputFileSha256=sha(fs.readFileSync(path.join(dir,'frozen-input.json')));report.beforeKill=brief(initial);report.status='RUNNING';save();
    // Target selection is revalidated immediately before the only destructive command.
    assert.deepEqual(containerSuffixes(workers).map(suffix=>inspect(suffix)),report.containersBefore);inspectWorkers();assert.deepEqual(inspectDb(),report.databaseContainerBefore);assert.deepEqual(topology(report.containersBefore,report.databaseContainerBefore),report.networkBefore);await policy();
    const immediatelyBeforeKill=await state(report.jobId);assertPoolHealthy();assert.equal(immediatelyBeforeKill.status,'RUNNING');assert.equal(immediatelyBeforeKill.attempts,1);assert.equal(immediatelyBeforeKill.engineRelease,pins.jobEngine);assert.deepEqual(immediatelyBeforeKill.input,initial.input);
    stopped=true;docker(['kill','--signal','SIGKILL',...ids]);report.events.push({type:'SIGKILL',containerIds:ids,at:new Date().toISOString()});
    report.killed=initialWorkers.map(row=>{const actual=dockerJson(['inspect',row.id])[0];assert.equal(actual.Id,row.id);assert.equal(actual.State.Running,false);assert.equal(actual.State.ExitCode,137);return{id:actual.Id,running:false,exitCode:137};});
    const afterKill=await state(report.jobId);assert.equal(afterKill.status,'RUNNING','Kill must precede finalization');assert.equal(afterKill.attempts,1);assert.equal(afterKill.projectId,null);report.afterKill=brief(afterKill);
    const expiryDeadline=performance.now()+60000;do{assertPoolHealthy();const started=performance.now(),response=await fetch(CONTOUR.origin+'/api/health',{signal:AbortSignal.timeout(5000)}),body=await response.json();report.health.push({status:response.status,db:body.db,ms:performance.now()-started});const clock=await db.query('SELECT EXTRACT(EPOCH FROM clock_timestamp()) AS "serverEpoch",EXTRACT(EPOCH FROM "leaseUntil") AS "leaseEpoch",clock_timestamp() >= "leaseUntil" + interval \'1 second\' AS expired FROM "CalculationJob" WHERE id=$1 AND "ownerId"=$2',[report.jobId,owner]);assert.equal(clock.rowCount,1);report.leaseClock=clock.rows[0];save();assertPoolHealthy();if(report.leaseClock.expired)break;assert.ok(performance.now()<expiryDeadline,'Lease expiry deadline');await sleep(250);}while(true);
    const expired=await state(report.jobId);assert.equal(expired.status,'RUNNING');assert.equal(expired.attempts,1);assert.deepEqual(expired.input,initial.input);report.expiredBeforeRestart=brief(expired);
    assertPoolHealthy();docker(['start',...ids]);stopped=false;report.events.push({type:'START_SAME_IDS',containerIds:ids,at:new Date().toISOString()});
    let final;const doneDeadline=performance.now()+120000;do{assertPoolHealthy();final=await state(report.jobId);if(['SUCCEEDED','FAILED','CANCELLED'].includes(final.status))break;assert.ok(final.attempts<=2,'No hidden third attempt');assert.ok(performance.now()<doneDeadline,'Recovery result deadline');await sleep(200);}while(true);
    assertRecoveryIdentity(initial,final,owner);assert.equal(final.engineRelease,pins.jobEngine);assertCreateFrozen(final.input,fixed,profile,run);
    for(const [table,field]of [['Project','userId'],['CalculationRun','ownerId'],['CalculationJob','ownerId'],['CalculationSubmission','ownerId']])assert.equal((await db.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "${field}"=$1`,[owner])).rows[0].n,1,'Exactly one '+table);
    const projectRow=(await db.query('SELECT id,revision,results FROM "Project" WHERE id=$1 AND "userId"=$2',[final.projectId,owner])).rows[0];assert.equal(projectRow.revision,0);assert.deepEqual(projectRow.results,final.results);
    const response=await request('/api/v1/calculation-jobs/'+report.jobId+'/result');report.resultHttpStatus=response.status;assert.equal(response.status,200);const result=await response.json();fs.writeFileSync(path.join(dir,'recovered-result.json'),JSON.stringify(result),{flag:'wx'});
    for(const [key,wanted]of [['id',final.id],['runId',final.runId],['attempts',2],['status','SUCCEEDED'],['publicationState','PUBLISHED'],['publishedRevision',0],['engineRelease',pins.jobEngine]])assert.equal(result.job[key],wanted);assert.deepEqual(result.results,final.results);
    const verified=assertQualifiedCapacity(result.results,profile.versions);assertCanonicalCase(verified,profile);assert.equal(businessSignature(result.results),businessSignature(reference.results));
    assert.deepEqual(result.results.results,reference.results.results,'All financial rows, ROI/TCO/cashflows and risks must match the verified current reference');
    assert.equal(sha(fs.readFileSync(path.join(dir,'frozen-input.json'))),report.frozenInputFileSha256);
    report.afterRecovery=brief(final);report.exactlyOneProject=true;report.resultSha256=sha(fs.readFileSync(path.join(dir,'recovered-result.json')));report.nominal=verified.evidence.summary;report.controlled=verified.proof.metrics;
    report.containersAfter=containerSuffixes(workers).map(suffix=>inspect(suffix));assertRestartIdentity(initialWorkers,report.containersAfter.filter(row=>row.name.includes('-worker-')),workers);assert.deepEqual(report.containersAfter[0],report.containersBefore[0]);inspectWorkers();
    assert.deepEqual(inspectDb(),report.databaseContainerBefore);report.networkAfter=topology(report.containersAfter,report.databaseContainerBefore);assert.deepEqual(report.networkAfter,report.networkBefore);assert.deepEqual(await identity(),report.databaseBefore);assert.deepEqual(await policy(),report.policyBefore);assert.deepEqual(sourceGraph(repo,pins.engine),graph);assert.deepEqual(filePins(),pinsBefore);assert.deepEqual(host(),hostBefore);assert.deepEqual(dockerHost(),dockerBefore);assert.ok(report.health.length>0&&report.health.every(row=>row.status===200&&row.db===true));
    assertPoolHealthy();report.pass=true;report.status='PASS';
  }catch(error){report.status='FAIL';report.failure=safeError(error);process.exitCode=1;}
  finally{
    if(stopped){try{for(const row of initialWorkers){const actual=dockerJson(['inspect',row.id])[0];assert.equal(actual.Id,row.id);assert.equal(actual.Image,row.image);assert.equal(actual.Config.Labels['com.docker.compose.project'],CONTOUR.project);assert.equal(actual.Config.Labels['com.docker.compose.service'],'worker');assert.deepEqual(resourceLimits(actual),row.limits);}docker(['start',...ids]);report.events.push({type:'FAILURE_RESTORE_SAME_IDS',at:new Date().toISOString()});}catch(error){report.restoreFailure=safeError(error);}}
    report.finishedAt=new Date().toISOString();save();await db.end();console.log(JSON.stringify({status:report.status,pass:report.pass,jobId:report.jobId,attempts:report.afterRecovery?.attempts,error:report.failure}));
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)main().catch(error=>{if(preflightEvidence){preflightEvidence.report.status='FAIL';preflightEvidence.report.pass=false;preflightEvidence.report.failure=safeError(error);preflightEvidence.report.finishedAt=new Date().toISOString();preflightEvidence.save();}console.error(JSON.stringify({preflightFailed:true,error:safeError(error)}));process.exitCode=1;});
