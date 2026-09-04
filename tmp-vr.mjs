import { chromium } from "playwright";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 1200 } })).newPage();
await p.goto("http://localhost:3000/calculate/cmsyqj7pt000j8ep4q7egt6ae", { waitUntil: "networkidle" });
const sel = p.locator("#region"), lab = p.locator("#laborCostPerHourUsd"), rate = p.locator("#usdToRub");
const npv = async () => ((await p.locator("text=Результаты").locator("xpath=../..").innerText()).match(/NPV[^\n]*/)||[""])[0].slice(0,44);
await sel.selectOption("moscow"); await p.waitForTimeout(300);
console.log(`  pick Москва @90   labour=$${await lab.inputValue()}`);
await rate.fill("110"); await rate.blur(); await p.waitForTimeout(450);
const before = { l: await lab.inputValue(), n: await npv() };
console.log(`  rate -> 110       labour=$${before.l}   ${before.n}`);
await sel.selectOption(""); await p.waitForTimeout(500);
const after = { l: await lab.inputValue(), n: await npv() };
console.log(`  «свои значения»   labour=$${after.l}   ${after.n}`);
console.log(`  => ${before.l !== after.l ? "*** CONFIRMED: detaching the preset silently changed the rate ***" : "rate kept"}`);

// finding 5 — Russian plural in the canvas label
const label = await p.locator("canvas").getAttribute("aria-label");
console.log(`\n  canvas aria-label: "${label.slice(0, 52)}…"`);
