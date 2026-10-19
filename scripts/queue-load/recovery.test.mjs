import { describe, expect, it } from 'vitest';
import cp from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { recoveryRoute, assertLoadReference, assertCreateFrozen, assertRecoveryIdentity, assertKillTargets, assertRestartIdentity, attachRecoveryPoolErrors } from '../check-queue-recovery.mjs';
import { CONTOUR, sha, catalogueSignature, workerNames, serviceNetwork, assertAppPort, assertWorkerStartup } from './declaration.mjs';
import { RESOURCE_FIELDS, resourceLimits } from './benchmark-contract.mjs';
import { canonicalJson, inputIdentity } from '../submission-capacity-contract.mjs';

const script=fileURLToPath(new URL('../check-queue-recovery.mjs',import.meta.url));
const engine='alfa-robot/sha256:'+'a'.repeat(64),jobEngine=engine+'/stage3';
const env=()=>({QUEUE_RECOVERY_GO:'RUN',QUEUE_LOAD_WORKERS:'12',QUEUE_LOAD_PROJECT:CONTOUR.project,QUEUE_LOAD_ORIGIN:CONTOUR.origin,DATABASE_URL:'postgresql://fixture:temporary@127.0.0.1:55440/alfa_queue_scaled',QUEUE_LOAD_EXPECT_ENGINE:engine,QUEUE_LOAD_EXPECT_JOB_ENGINE:jobEngine,QUEUE_LOAD_EXPECT_APP_IMAGE:'sha256:'+'b'.repeat(64),QUEUE_LOAD_EXPECT_WORKER_IMAGE:'sha256:'+'c'.repeat(64)});

function referenceFixture(workers=12){
  const versions={economics:'tz-fixture',analytical:'sim-fixture',spatial:'spatial-fixture'};
  const source={seed:1,transportWorkflow:'closed-pod-1',layout:{chargers:2},robots:{count:6},demand:{avgPerH:40,peakPerH:51.81818181818182,warmupMin:15,peakMin:120,mix:{inbound:.5,outbound:.5,internal:0}},thresholds:{p95WaitMaxMin:5}};
  const input=structuredClone(source);input.demand.offered={protocol:'periodic-capacity-1',perH:source.demand.peakPerH*1.10};
  const diagnostics={pendingWaitMaxS:0,blockedWaitMaxS:0,unfinished:[]};
  const evidence={input:source,sourceInputKey:inputIdentity(source,versions.analytical),executionInputKey:inputIdentity(source,versions.analytical),simModelVersion:versions.spatial,assessment:{status:'PARTIAL',terminal:true},summary:{fleet:6,requiredPerH:source.demand.peakPerH,achievedPerH:51.5,queueEnd:1,waitP95Min:4.9},capacityNominalReview:{eligible:true,reasons:[],diagnostics},capacityProof:{schemaVersion:'capacity-proof-1',protocolId:'periodic-110-15-120-cohort-closed-1',sourceInputKey:inputIdentity(source,versions.analytical),testInputKey:inputIdentity(input,versions.analytical),executionInputKey:inputIdentity(input,versions.analytical),input,simModelVersion:versions.spatial,status:'PASS',terminal:true,metrics:{requiredPerH:source.demand.peakPerH,offeredPerH:input.demand.offered.perH,arrivedPerH:57,deliveredCohort:110,closedCohort:109,deliveredCohortPerH:55,closedCohortPerH:54.5,measurementStartS:900,measurementEndS:8100,unfinishedCustomerCount:0,unfinishedServiceCount:0,oldestUnfinishedAgeS:0},qualificationDiagnostics:diagnostics}};
  const results={modelVersion:versions.economics,simModelVersion:versions.analytical,runtime:{simInputs:{purchase:{calculated:source}}},scenarios:[{key:'purchase',kind:'purchase',items:[{process:'pallet-transport',productSlug:'ronavi-h1500'}],spatialEvidence:evidence}],results:[{key:'purchase',kind:'purchase',status:'ok',npvRub:4079992,items:[{n:6,chargers:2,process:'pallet-transport',productSlug:'ronavi-h1500'}]}],conclusion:{recommendedScenarioKey:null}};
  const fixed={operation:'CALCULATE',facility:'warehouse',params:{area:5000},scenarios:[{key:'purchase',items:[{n:6}]}]};
  const profile={versions,initial:{params:fixed.params},declaredCase:{sourceInputKeySha256:sha(evidence.sourceInputKey)}};
  const reference={job:{id:'reference-job',runId:'reference-run',status:'SUCCEEDED',attempts:1,publicationState:'NONE',engineRelease:jobEngine},results};
  const referenceBytes=Buffer.from(JSON.stringify(reference));
  const pins={engine,jobEngine,images:{app:env().QUEUE_LOAD_EXPECT_APP_IMAGE,worker:env().QUEUE_LOAD_EXPECT_WORKER_IMAGE},profile:'profile-sha',resources:'resources-sha',referenceBytes};
  const load={schema:'stage3-load-result-1',status:'FAIL',configuration:{project:CONTOUR.project,httpPort:3087,dbPort:55440,database:'alfa_queue_scaled',workers,globalLeaseCap:workers,workerPoolMax:2,engine,jobEngine,images:pins.images,profileSha256:pins.profile,declaredResourcesSha256:pins.resources,requestSha256:sha(canonicalJson(fixed))},phases:[{name:'reference',functionalPass:true,compute60Pass:true,requests:[{verified:true,jobId:'reference-job',runId:'reference-run',verification:{sha256:sha(referenceBytes)}}]}]};
  return{load,fixed,reference,profile,pins};
}

describe('guarded stage3 recovery',()=>{
  it.each([12,14])('binds recovery route, completed load and immutable kill IDs to declared%s',workers=>{
    const route=recoveryRoute({...env(),QUEUE_LOAD_WORKERS:String(workers)});
    expect(route.workerCount).toBe(workers);expect(route.workers).toEqual(workerNames(workers));
    const f=referenceFixture(workers);assertLoadReference(f.load,f.fixed,f.reference,f.profile,f.pins,workers);
    expect(()=>assertLoadReference(f.load,f.fixed,f.reference,f.profile,f.pins,workers===12?14:12)).toThrow();
    const before=workerNames(workers).map((name,index)=>({name,id:(index+1).toString(16).padStart(64,'0'),startedAt:'before'}));
    expect(assertKillTargets(before,workers)).toHaveLength(workers);
    expect(()=>assertKillTargets(before,workers===12?14:12)).toThrow();
    assertRestartIdentity(before,before.map(row=>({...row,startedAt:'after'})),workers);
    const duplicate=structuredClone(before);duplicate[0].id=duplicate[1].id;expect(()=>assertKillTargets(duplicate,workers)).toThrow();
  });
  it.each([undefined,'13','14 ','','1.4e1'])('rejects undeclared recovery capacity before external IO: %j',QUEUE_LOAD_WORKERS=>{
    expect(()=>recoveryRoute({...env(),QUEUE_LOAD_WORKERS})).toThrow();
  });
  it('is safe to import and admits exactly the declared route and twelve worker names',()=>{expect(recoveryRoute(env()).workers).toHaveLength(12);});
  it.each([
    ['QUEUE_RECOVERY_GO',''],['QUEUE_LOAD_PROJECT','other-stack'],['QUEUE_LOAD_ORIGIN','http://127.0.0.1:3085'],['QUEUE_LOAD_ORIGIN',CONTOUR.origin+'/?override=1'],['DATABASE_URL','postgresql://fixture:temporary@127.0.0.1:55436/alfa_queue_scaled'],['DATABASE_URL','postgresql://fixture:temporary@127.0.0.1:55440/alfa_queue_scaled?port=55436'],['QUEUE_LOAD_EXPECT_ENGINE','old'],['QUEUE_LOAD_EXPECT_JOB_ENGINE',engine+'/'],['QUEUE_LOAD_EXPECT_APP_IMAGE','latest'],
  ])('rejects undeclared %s before IO',(key,value)=>{expect(()=>recoveryRoute({...env(),[key]:value})).toThrow();});
  it('accepts a verified reference without upgrading its failed load SLA',()=>{const f=referenceFixture();expect(()=>assertLoadReference(f.load,f.fixed,f.reference,f.profile,f.pins,12)).not.toThrow();expect(f.load.status).toBe('FAIL');});
  it.each(['old-schema','running-load','wrong-cap','old-engine','wrong-images','old-profile','old-resources','changed-request','unverified-reference','reference-attempt2','nominal-promoted','unsafe-nominal','negative-finance'])('rejects invalid actual reference: %s',kind=>{
    const f=referenceFixture();
    if(kind==='old-schema')f.load.schema='historical';if(kind==='running-load')f.load.status='RUNNING';if(kind==='wrong-cap')f.load.configuration.globalLeaseCap=2;if(kind==='old-engine')f.load.configuration.engine='old';if(kind==='wrong-images')f.load.configuration.images={app:'old',worker:'old'};if(kind==='old-profile')f.load.configuration.profileSha256='old';if(kind==='old-resources')f.load.configuration.declaredResourcesSha256='old';if(kind==='changed-request')f.fixed.params.area=10000;if(kind==='unverified-reference')f.load.phases[0].requests[0].verified=false;if(kind==='reference-attempt2')f.reference.job.attempts=2;if(kind==='nominal-promoted')f.reference.results.scenarios[0].spatialEvidence.assessment.status='OK';if(kind==='unsafe-nominal')f.reference.results.scenarios[0].spatialEvidence.capacityNominalReview.reasons=['unsafe'];if(kind==='negative-finance')f.reference.results.results[0].npvRub=-1;
    expect(()=>assertLoadReference(f.load,f.fixed,f.reference,f.profile,f.pins,12)).toThrow();
  });
  it('binds actual CREATE frozen fields and catalogue without replacing CALCULATE semantics',()=>{
    const f=referenceFixture(),live={products:[],norms:{rate:.12},paramDefs:[]},profile={...f.profile,catalogueSha256:catalogueSignature(live)},frozen={schemaVersion:1,operation:'CREATE',input:{facility:f.fixed.facility,params:f.fixed.params,scenarios:f.fixed.scenarios},live,publication:{name:'run',reservedProjectId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}};
    assertCreateFrozen(frozen,f.fixed,profile,'run');const changed=structuredClone(frozen);changed.live.norms.rate=0;expect(()=>assertCreateFrozen(changed,f.fixed,profile,'run')).toThrow();changed.live=live;changed.input.scenarios=[];expect(()=>assertCreateFrozen(changed,f.fixed,profile,'run')).toThrow();
  });
  it.each(['valid','attempt3','changed-run','changed-input','changed-engine','duplicate-project-id','not-published','revision1','live-lease','cancelled'])('checks exact recovered job identity: %s',kind=>{
    const input={schemaVersion:1,operation:'CREATE'},initial={id:'job',runId:'run',ownerId:'owner',input,inputHash:sha(canonicalJson(input)),engineRelease:jobEngine,reservedProjectId:'project',status:'RUNNING',attempts:1};
    const final={...structuredClone(initial),status:'SUCCEEDED',attempts:2,projectId:'project',publicationState:'PUBLISHED',publishedRevision:0,leaseToken:null,leaseUntil:null,cancelRequestedAt:null};
    if(kind==='attempt3')final.attempts=3;if(kind==='changed-run')final.runId='another';if(kind==='changed-input')final.input={operation:'CALCULATE'};if(kind==='changed-engine')final.engineRelease='old';if(kind==='duplicate-project-id')final.projectId='another';if(kind==='not-published')final.publicationState='STALE';if(kind==='revision1')final.publishedRevision=1;if(kind==='live-lease')final.leaseToken='active';if(kind==='cancelled')final.cancelRequestedAt='now';
    if(kind==='valid')assertRecoveryIdentity(initial,final,'owner');else expect(()=>assertRecoveryIdentity(initial,final,'owner')).toThrow();
  });
  const workerFixture=()=>workerNames(12).map((name,index)=>({id:(index+1).toString(16).padStart(64,'0'),name,image:'image',limits:{Memory:1024},startedAt:'before'}));
  it.each(['missing-worker','foreign-name','duplicate-id','option-injection','short-id','extra-worker'])('refuses unsafe kill selection: %s',kind=>{const rows=workerFixture();if(kind==='missing-worker')rows.pop();if(kind==='foreign-name')rows[0].name='other-project-worker-1';if(kind==='duplicate-id')rows[0].id=rows[1].id;if(kind==='option-injection')rows[0].id='--all';if(kind==='short-id')rows[0].id='abc';if(kind==='extra-worker')rows.push({...rows[0],name:'extra'});expect(()=>assertKillTargets(rows,12)).toThrow();});
  it('permits only changed start times when restarting the same twelve containers',()=>{const before=workerFixture(),after=before.map(row=>({...row,startedAt:'after'}));assertRestartIdentity(before,after,12);for(const field of ['id','image','limits']){const bad=structuredClone(after);bad[0][field]='changed';expect(()=>assertRestartIdentity(before,bad,12)).toThrow();}expect(()=>assertRestartIdentity(before,before,12)).toThrow();});
  it('allows reassigned worker IPs after restart while preserving network identity and aliases',()=>{const before=workerFixture().map(row=>({...row,network:{name:CONTOUR.project+'_default',id:'d'.repeat(64),address:'172.20.0.2',aliases:['worker']}}));const after=before.map(row=>({...row,startedAt:'after',network:{...row.network,address:'172.20.0.3'}}));assertRestartIdentity(before,after,12);const foreign=structuredClone(after);foreign[0].network.id='e'.repeat(64);expect(()=>assertRestartIdentity(before,foreign,12)).toThrow();});
  it('actual recovery inspect rejects the independently reproduced unrelated network',()=>{
    const source=fs.readFileSync(script,'utf8'),start=source.indexOf('  const inspect=(suffix'),end=source.indexOf('  const inspectWorkers=',start);expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
    const limits=Object.fromEntries(RESOURCE_FIELDS.map(key=>[key,key.startsWith('Cpuset')?'':0])),name=workerNames(12)[0],embedded={engineRelease:engine,sources:['fixture']};
    let row={Name:'/'+name,Id:'c'.repeat(64),State:{Running:true,StartedAt:'before'},Image:env().QUEUE_LOAD_EXPECT_WORKER_IMAGE,Config:{Labels:{'com.docker.compose.project':CONTOUR.project,'com.docker.compose.service':'worker'},Env:['DATABASE_URL=postgresql://fixture:temporary@db:5432/alfa_queue_scaled','CALCULATION_ENGINE_RELEASE=stage3']},HostConfig:limits,NetworkSettings:{Networks:{[CONTOUR.project+'_default']:{NetworkID:'d'.repeat(64),IPAddress:'172.20.0.2',Aliases:['worker']}}}};
    const inspect=new Function('CONTOUR','dockerJson','assert','pins','resourceLimits','resources','docker','sha','canonicalJson','fs','path','repo','assertWorkerStartup','serviceNetwork','assertAppPort','workers',source.slice(start,end)+';return inspect;')(CONTOUR,args=>args[0]==='inspect'?[row]:embedded,assert,{images:{worker:row.Image},engine,jobEngine},resourceLimits,{containers:{[name]:limits}},()=>`calculation_worker_started engine=${jobEngine} instance=fixture:1 concurrency=1 globalCap=12 dbPoolMax=2 policy=database`,sha,canonicalJson,{readFileSync:()=>JSON.stringify(embedded)},path,'memory-only',assertWorkerStartup,serviceNetwork,assertAppPort,12);
    expect(inspect('worker-1').network.id).toBe('d'.repeat(64));
    row=structuredClone(row);row.NetworkSettings.Networks={unrelated_default:{NetworkID:'d'.repeat(64),IPAddress:'172.20.0.2',Aliases:['worker']}};expect(()=>inspect('worker-1')).toThrow();
  });
  it('idle pool error stays inside the async failure/restore path and is sanitized',async()=>{
    const pool=new EventEmitter(),report={status:'RUNNING',pass:false};let saves=0,fatal=0,restored=false;
    const healthy=attachRecoveryPoolErrors(pool,report,()=>{saves++;},()=>{fatal++;});healthy();
    const run=async()=>{try{await Promise.resolve();pool.emit('error',Object.assign(new Error('postgresql://private-password@secret-host/db'),{code:'ECONNRESET'}));healthy();report.pass=true;}finally{restored=true;}};
    await expect(run()).rejects.toThrow('Database pool');expect(restored).toBe(true);expect(report.status).toBe('FAIL');expect(report.pass).toBe(false);expect(saves).toBe(1);expect(fatal).toBe(1);expect(JSON.stringify(report)).not.toContain('private-password');
    report.status='PASS';report.pass=true;pool.emit('error',new Error('late failure'));expect(report.status).toBe('FAIL');expect(report.pass).toBe(false);expect(()=>healthy()).toThrow();
  });
  it('help and absent GO never invoke Docker, HTTP or PostgreSQL',()=>{
    const help=cp.spawnSync(process.execPath,[script,'--help'],{encoding:'utf8',windowsHide:true,env:{...process.env,DATABASE_URL:'not-a-database'}});expect(help.status).toBe(0);expect(help.stdout).toContain('SIGKILL');
    const denied=cp.spawnSync(process.execPath,[script],{encoding:'utf8',windowsHide:true,env:{...process.env,QUEUE_RECOVERY_GO:'',DATABASE_URL:'secret-invalid'}});expect(denied.status).toBe(1);expect(denied.stdout+denied.stderr).not.toContain('secret-invalid');
    const text=fs.readFileSync(script,'utf8');expect(text).not.toMatch(/UPDATE\s+"CalculationJob"/i);expect(text).not.toContain('DELETE FROM');expect(text).toContain("docker(['kill','--signal','SIGKILL',...ids])");
  });
});
