import { describe, expect, it } from "vitest";
import { complexSite } from "../../experiments/warehouse-3d/site";
import { calculateProjectPreview } from "../../experiments/warehouse-3d/project-input";
import { paramSpecsFor } from "../data/organizer/params";
import { checkScenarioSiteLayout, validateScenarioSpecs } from "../projects/validate";
import { resultsFromInputs } from "../projects/recalc";
import { expectedLegsM } from "../sim/analytic";
import { expectedClosedPodCycleS, expectedClosedPodLegsM } from "../sim/closed-pod-cycle";
import { prepareClosedPodSource } from "../sim/underlift-layout";
import { simInputIdentity } from "../sim/identity";
import { createSpatialProjectSnapshot } from "../sim/spatial-bridge";
import { spatialEvidenceMatchesInput } from "../sim/spatial-evidence";
import { routeLengthBetween } from "../sim/routing";
import { FIXTURE_H1500, fixtureContext, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "./econ/fixtures";
import { computeScenariosCore } from "./econ/core";
import { buildProjectModel, expectedSpatialInputFromStored } from "./model";
import { resolveNorms } from "./norms";
import type { ScenarioOk } from "./types";

const live = { paramDefs: paramSpecsFor("warehouse"), products: [FIXTURE_H1500], norms: resolveNorms(), paramDefsFrom: "code" as const };
function args() {
 const site=complexSite(10000,1), specs=fixtureSpecs();
 for(const s of specs)if(s.kind!=='asis'){s.siteLayout=structuredClone(site);s.simSeed=719;s.items[0]!.quantityOverride=3;s.items[0]!.chargersOverride=1;}
 return {...live,facility:'warehouse',params:{...WAREHOUSE_BASE_PARAMS,activeAreaM2:10000,receivingDocksCount:2,shippingDocksCount:2},scenarios:specs};
}
describe('one explicit site in financial cycle, simulation and persisted proof',()=>{
 it('computes all storage-to-storage legs on actual graph routes, not the typical-grid shortcut',()=>{
  const site=complexSite(10000,1), avg=(a:typeof site.slots,b:typeof site.slots)=>a.reduce((sum,p)=>sum+b.reduce((n,q)=>n+routeLengthBetween(site,p.x,p.y,q.x,q.y),0),0)/(a.length*b.length);
  const expected={loadedM:.5*(avg(site.receiving,site.slots)+avg(site.slots,site.shipping)),emptyM:.25*(avg(site.slots,site.receiving)+avg(site.slots,site.slots)+avg(site.shipping,site.receiving)+avg(site.shipping,site.slots))};
  expect(expectedLegsM(site)).toEqual(expected);
 });
 it('uses exact same plan/seed/points for cycle and SimInput while preserving the original',()=>{
  const input=args(),before=structuredClone(input),m=buildProjectModel(input),row=m.results.find(r=>r.key==='p1') as ScenarioOk;
  const site=input.scenarios[1]!.siteLayout!,physical=prepareClosedPodSource(site),legs=expectedClosedPodLegsM(physical.layout,physical.config.docks),sim=m.simInputs.p1!.calculated!;
  expect(row.status).toBe('ok');expect(row.items[0]!.routeLoadedM).toBe(legs.loadedM);expect(row.items[0]!.routeEmptyM).toBe(legs.emptyM);
  expect(row.items[0]!.thrCycle).toBe(3600/expectedClosedPodCycleS({...legs,speedMps:sim.robots.speedMps,loadedSpeedFactor:sim.robots.loadedSpeedFactor,handlingSec:sim.robots.handlingSec})!);
  expect(sim.siteLayout).toEqual(site);expect(sim.seed).toBe(719);expect(input).toEqual(before);
  expect(checkScenarioSiteLayout(site)).toEqual(site);
  expect(validateScenarioSpecs(input.scenarios,'warehouse',[FIXTURE_H1500.slug],['pallet-transport']).ok).toBe(true);
 });
 it('server replay and stored report input preserve the same complex geometry and real proof',()=>{
  const input=args(),first=buildProjectModel(input),source=first.simInputs.p1!.calculated!;
  const actual=calculateProjectPreview(createSpatialProjectSnapshot({requestId:'complex-test',scenarioKey:'p1',scenarioName:'Покупка',variantId:'calculated',input:source}));
  input.scenarios[1]!.spatialEvidence={input:source,sourceInputKey:simInputIdentity(source),executionInputKey:simInputIdentity(actual.input),simModelVersion:actual.simModelVersion,assessment:{status:'OK',headline:'forged',terminal:true},summary:{fleet:3,requiredPerH:source.demand.peakPerH,achievedPerH:999999,queueEnd:0,waitP95Min:0}};
  const saved=resultsFromInputs(live,input),expected=expectedSpatialInputFromStored(saved.results,'p1'),proof=saved.results.scenarios[1]!.spatialEvidence!;
  expect(expected).toEqual(source);expect(proof.input.siteLayout).toEqual(source.siteLayout);expect(proof.summary.achievedPerH).toBe(actual.summary.achievedPerH);
  expect(proof.assessment.headline).not.toBe('forged');expect(spatialEvidenceMatchesInput(proof,expected)).toBe(true);
  expect((saved.results.results.find(r=>r.key==='p1') as ScenarioOk).npvRub).toBe((first.results.find(r=>r.key==='p1') as ScenarioOk).npvRub);
  const changed=structuredClone(input);changed.scenarios[1]!.siteLayout!.walls!.push({x:1,y:1,w:1,h:1});
  const different=buildProjectModel(changed);expect(different.results.find(r=>r.key==='p1')!.risks.some(r=>r.code==='SPATIAL_STALE')).toBe(true);
 // Independent spatial replay plus server recheck and complex-model rebuilds precede archive identity checks.
 }, 120_000);
 it('rejects area, operation-point and charger mismatch rather than silently rebuilding the plan',()=>{
  for(const change of ['area','docks','chargers'] as const){const input=args();if(change==='area')input.params.activeAreaM2=12000;else if(change==='docks')input.params.receivingDocksCount=3;else input.scenarios[1]!.items[0]!.chargersOverride=2;
   const m=buildProjectModel(input);expect(m.results.find(r=>r.key==='p1')!.status).toBe('refused');expect(m.simInputs.p1!.calculated).toBeNull();}
  const bad=complexSite(10000,1);bad.walls![0]!.x=NaN;expect(()=>checkScenarioSiteLayout(bad)).toThrow();
 // Each mismatch still builds the other valid complex scenario; this outer correctness budget is not a runtime SLA.
 }, 30_000);
 it('refuses a sub-body-clearance site in the financial model and persisted geometry boundary',()=>{
  const input=args();input.scenarios[1]!.siteLayout!.routingGraph!.clearanceM=0;
  const before=structuredClone(input),m=buildProjectModel(input);
  expect(m.results.find(r=>r.key==='p1')!.status).toBe('refused');
  expect(m.simInputs.p1!.calculated).toBeNull();
  expect(()=>checkScenarioSiteLayout(input.scenarios[1]!.siteLayout)).toThrow(/радиуса корпуса/);
  expect(input).toEqual(before);
 });
 it('leaves the standard plan path unchanged when explicit geometry is absent',()=>{
  const input={...live,facility:'warehouse',params:{...WAREHOUSE_BASE_PARAMS},scenarios:fixtureSpecs()},a=buildProjectModel(input);
  const b=buildProjectModel({...input,scenarios:input.scenarios.map(s=>({...s,siteLayout:undefined,simSeed:undefined}))});
  expect(a.results).toEqual(b.results);expect(a.simInputs).toEqual(b.simInputs);
 });
 it('cannot bypass the shared project geometry by calling the money engine with an unrelated typical cycle',()=>{
  const result=computeScenariosCore(fixtureContext(),args().scenarios);
  expect(result.find(r=>r.key==='p1')!.status).toBe('refused');
 });
});
