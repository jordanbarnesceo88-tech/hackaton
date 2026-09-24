import { describe, expect, it } from "vitest";
import { bernoulliArrivals, createRng, mulberry32, nextRandom } from "./rng";

describe("mulberry32", () => {
  it("одно зерно — одна и та же последовательность", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it("разные зёрна дают разные последовательности", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const sa = Array.from({ length: 10 }, () => a());
    const sb = Array.from({ length: 10 }, () => b());
    expect(sa).not.toEqual(sb);
  });

  it("числа в [0, 1), среднее около 0,5", () => {
    const r = mulberry32(7);
    let sum = 0;
    let out = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = r();
      if (!(v >= 0 && v < 1)) out++;
      sum += v;
    }
    expect(out).toBe(0);
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it("закреплённые первые значения (регрессия алгоритма: Node и браузер обязаны совпасть)", () => {
    const r = mulberry32(1);
    expect([r(), r(), r()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it("функция и состояние-число дают одно и то же", () => {
    const f = mulberry32(123);
    const st = createRng(123);
    for (let i = 0; i < 100; i++) expect(nextRandom(st)).toBe(f());
  });
});

describe("bernoulliArrivals", () => {
  it("нулевая и отрицательная интенсивность — ноль заданий и генератор не расходуется", () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0;
    };
    expect(bernoulliArrivals(rng, 0)).toBe(0);
    expect(bernoulliArrivals(rng, -1)).toBe(0);
    expect(bernoulliArrivals(rng, Number.NaN)).toBe(0);
    expect(calls).toBe(0);
  });

  it("при λ·dt ≤ 0,1 — одно испытание, среднее равно λ·dt", () => {
    const rng = mulberry32(5);
    const rate = 129.55 / 3600;
    let n = 0;
    let bad = 0;
    const steps = 200_000;
    for (let i = 0; i < steps; i++) {
      const k = bernoulliArrivals(rng, rate);
      if (k !== 0 && k !== 1) bad++;
      n += k;
    }
    expect(bad).toBe(0);
    expect(n / steps).toBeCloseTo(rate, 3);
  });

  it("при λ·dt > 0,1 — под-испытания: целое число не больше ⌈λ·dt / 0,1⌉, среднее равно λ·dt", () => {
    const rng = mulberry32(9);
    const rate = 0.55;
    let n = 0;
    let bad = 0;
    const steps = 100_000;
    for (let i = 0; i < steps; i++) {
      const k = bernoulliArrivals(rng, rate);
      if (!Number.isInteger(k) || k < 0 || k > 6) bad++;
      n += k;
    }
    expect(bad).toBe(0);
    expect(n / steps).toBeCloseTo(rate, 2);
  });

  it("учитывает длину шага dt", () => {
    const rng = mulberry32(11);
    let n = 0;
    for (let i = 0; i < 50_000; i++) n += bernoulliArrivals(rng, 0.01, 5);
    expect(n / 50_000).toBeCloseTo(0.05, 2);
  });
});
