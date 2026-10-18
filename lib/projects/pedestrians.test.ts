import { describe, expect, it } from "vitest";
import { complexSite } from "../../experiments/warehouse-3d/site";
import { FIXTURE_H1500, fixtureSpecs, WAREHOUSE_BASE_PARAMS } from "../tz/econ/fixtures";
import { paramSpecsFor } from "../data/organizer/params";
import { resolveNorms } from "../tz/norms";
import { buildProjectModel } from "../tz/model";
import { validatePendingChanges, validateScenarioSpecs } from "./validate";
import { scenarioFromRow } from "./queries";
import { changeFieldLabel, projectAuditDiff } from "./changes";
import { simInputIdentity } from "../sim/identity";
import type { PedestrianInput } from "../sim/types";
function source(){
  const site=complexSite(10000,1,true),scenarios=fixtureSpecs();
  const pedestrians:PedestrianInput={version:"pedestrians-1",policy:"controlled-crossing",crossingWidthM:2,reactionTimeS:.5,decelerationMps2:.8,accelerationMps2:.8,clearanceM:.25,people:[{id:"person-source",radiusM:.3,trajectory:[{tS:0,x:124,y:10},{tS:600,x:124,y:10},{tS:620,x:124,y:30}]}]};
  for(const s of scenarios)if(s.kind!=="asis"){s.siteLayout=structuredClone(site);s.pedestrians=structuredClone(pedestrians);s.items[0]!.quantityOverride=3;s.items[0]!.chargersOverride=1;}
  return {facility:"warehouse",params:{...WAREHOUSE_BASE_PARAMS,activeAreaM2:10000,receivingDocksCount:2,shippingDocksCount:2},scenarios,products:[FIXTURE_H1500],paramDefs:paramSpecsFor("warehouse"),norms:resolveNorms()};
}
describe("canonical pedestrian assumption lifecycle",()=>{
  it("validates, builds, reopens and audits the same typed assumption instead of dropping it",()=>{
    const input=source(),before=structuredClone(input),checked=validateScenarioSpecs(input.scenarios,"warehouse",[FIXTURE_H1500.slug],["pallet-transport"]);
    expect(checked.ok).toBe(true);if(!checked.ok)return;
    // Validate the complete submitted set, but build only the scenario under test.
    // RaaS economics would repeat the same geometry without testing another assumption.
    const model=buildProjectModel({...input,scenarios:checked.value.filter(s=>s.key!=="r1")}),physical=model.simInputs.p1!.calculated!;
    expect(model.results.find(r=>r.key==="p1")!.status).toBe("ok");expect(physical.pedestrians).toEqual(input.scenarios[1]!.pedestrians);
    const row=scenarioFromRow({key:"p1",name:"Покупка",kind:"PURCHASE",spec:JSON.parse(JSON.stringify(checked.value[1]))});
    expect(row.pedestrians).toEqual(physical.pedestrians);expect(input).toEqual(before);
    const baseline=structuredClone(input);delete baseline.scenarios[1]!.pedestrians;
    const diff=projectAuditDiff(baseline,input).filter(c=>c.field==="scenario:pedestrians");expect(diff).toHaveLength(1);
    expect(validatePendingChanges(diff).ok).toBe(true);expect(changeFieldLabel("scenario:pedestrians")).toBe("Модель пешеходов и параметры перехода");
    expect(simInputIdentity({...physical,pedestrians:undefined})).not.toBe(simInputIdentity(physical));
  });
  it("rejects misplaced or tampered assumptions without silently substituting a default",()=>{
    const input=source();input.scenarios[0]!.pedestrians=input.scenarios[1]!.pedestrians;
    expect(validateScenarioSpecs(input.scenarios,"warehouse",[FIXTURE_H1500.slug],["pallet-transport"]).ok).toBe(false);
    expect(buildProjectModel(input).results[0]!.status).toBe("refused");
    const absent=source();delete absent.scenarios[1]!.siteLayout;
    expect(validateScenarioSpecs(absent.scenarios,"warehouse",[FIXTURE_H1500.slug],["pallet-transport"]).ok).toBe(false);
    const tampered=source();Object.assign(tampered.scenarios[1]!.pedestrians!,{runtime:{safe:true}});
    expect(validateScenarioSpecs(tampered.scenarios,"warehouse",[FIXTURE_H1500.slug],["pallet-transport"]).ok).toBe(false);
    expect(validateScenarioSpecs(source().scenarios,"airport",[FIXTURE_H1500.slug],["pallet-transport"]).ok).toBe(false);
  });
});
