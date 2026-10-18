import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
import {MOBILE_RACK_SPEC,carrierSpec} from './carriers';

type Piece = {mat:string;role?:string;x:number;y:number;z:number;w:number;h:number;d:number;detail:boolean};
const browser = {window:{} as {warehouseCarrierParts?:(spec:typeof MOBILE_RACK_SPEC)=>Piece[]}};
runInNewContext(readFileSync(new URL('./scene.js',import.meta.url),'utf8'),browser);
const pieces=browser.window.warehouseCarrierParts!(MOBILE_RACK_SPEC);

describe('shared scene and modal carrier geometry versus physical envelope',()=>{
 it('keeps every steel, cargo and trim corner within the protected swept disk',()=>{
  for(const p of pieces){
   expect([p.x,p.y,p.z,p.w,p.h,p.d].every(Number.isFinite),p.mat).toBe(true);
   expect(Math.hypot(Math.abs(p.x)+p.w/2,Math.abs(p.z)+p.d/2),p.mat).toBeLessThanOrEqual(.90);
   expect(p.y-p.h/2,p.mat).toBeGreaterThanOrEqual(-1e-9);
   expect(p.y+p.h/2,p.mat).toBeLessThanOrEqual(MOBILE_RACK_SPEC.heightM+1e-9);
  }
 });
 it('represents a whole shelf with multiple loaded tiers and clearance over the robot',()=>{
  const trays=pieces.filter(p=>p.mat==='carrierTray');
  expect(trays).toHaveLength(MOBILE_RACK_SPEC.levels);
  expect(new Set(trays.map(p=>p.y)).size).toBe(MOBILE_RACK_SPEC.levels);
  expect(Math.min(...trays.map(p=>p.y-p.h/2))).toBeGreaterThanOrEqual(.38);
  expect(pieces.filter(p=>p.mat==='load'||p.mat==='loadLight').length).toBeGreaterThanOrEqual(12);
 });
 it('preserves the five-tier silhouette and real platform contact through the lift stroke',()=>{
  expect(MOBILE_RACK_SPEC).toMatchObject({lengthM:1.4,widthM:1,heightM:2.2,levels:5,baseClearanceM:.44,liftHeightM:.06});
  const feet=pieces.filter(p=>p.role==='foot'),contact=pieces.find(p=>p.role==='contact-face')!;
  expect(feet).toHaveLength(4);
  for(const foot of feet) expect(foot.y-foot.h/2).toBeCloseTo(0,9);
  expect(contact.y-contact.h/2).toBeCloseTo(.44,9);
  expect(.38+.06).toBeCloseTo(contact.y-contact.h/2,9);
  expect(.38+.12).toBeCloseTo(contact.y-contact.h/2+MOBILE_RACK_SPEC.liftHeightM,9);
 });
 it('rejects an envelope that cannot fit traffic clearance instead of clipping only its drawing',()=>{
  expect(()=>carrierSpec({loadCarrier:{...MOBILE_RACK_SPEC,lengthM:4}})).toThrow();
 });
});
