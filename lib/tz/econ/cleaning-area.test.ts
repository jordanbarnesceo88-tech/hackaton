import { describe, expect, it } from "vitest";
import { VENDOR_CLEANING_PRODUCTS } from "../../data/vendor-cleaning";
import { productForCalcFromSeed } from "../../catalog/product-for-calc";
import { baseValuesFor, paramSpecsFor } from "../../data/organizer/params";
import { compareCleaningOptions } from "../cleaning-selection";
import { resolveNorms } from "../norms";
import { computeScenariosCore } from "./core";
import { fixtureContext, fixtureSpecs } from "./fixtures";
import type { ScenarioOk } from "../types";

describe("explicit cleaning infrastructure footprint across supported facilities", () => {
  it.each(["warehouse","airport","medical"])("prices a real quoted cleaning option for %s using its cleaning area", facility => {
    const norms=resolveNorms();
    const input={facility,params:{...baseValuesFor(facility),cleaningAreaM2:8000,cleaningsPerDay:1,cleanersCount:8,cleanerSalaryRubMonth:65000,workDaysPerYear:300},
      products:VENDOR_CLEANING_PRODUCTS.map(productForCalcFromSeed),norms,paramDefs:paramSpecsFor(facility),mode:"scrubbing",
      quotes:{"pudu-cc1":{purchaseRub:2790000,source:"Явное синтетическое предложение для регрессии маршрута, не новая цена поставщика"}}};
    const row=compareCleaningOptions(input)[0]!;
    expect(row.purchase.result?.status,row.purchase.reason).toBe("ok");
    const result=row.purchase.result as ScenarioOk;
    expect(result.capexLines.find(l=>l.key==="infrastructure")).toMatchObject({valueRub:8000*norms.siteInfraRubPerM2,originNote:expect.stringContaining("cleaningAreaM2")});
    expect(row.purchase.rank).toBe(1);
    expect(compareCleaningOptions({...input,params:{...input.params,cleaningAreaM2:4000}})[0]!.purchase.result).toMatchObject({status:"ok",capexLines:expect.arrayContaining([expect.objectContaining({key:"infrastructure",valueRub:4000*norms.siteInfraRubPerM2})])});
  });
  it("keeps the existing transport footprint rather than borrowing cleaning area",()=>{
    const ctx=fixtureContext(),specs=fixtureSpecs();ctx.params.cleaningAreaM2=1;
    const row=computeScenariosCore(ctx,specs).find(r=>r.kind==='purchase') as ScenarioOk;
    expect(row.capexLines.find(l=>l.key==='infrastructure')!.valueRub).toBe(Number(ctx.params.activeAreaM2)*ctx.norms.siteInfraRubPerM2);
  });
});
