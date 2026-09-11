import { describe, it, expect } from "vitest";
import { resolveTaskFte } from "./task-labour";

describe("resolveTaskFte", () => {
  // Сценарий из спеки: пищевое производство, 15 000 операций/сутки × 250 дней = 3 750 000/год,
  // штат 80, норматив паллетирования 600 000 коробок/год.
  const base = { demandPerYear: 3_750_000, workerOutputPerYear: 600_000, staffCount: 80 };

  it("заявленная человеком занятость побеждает норматив", () => {
    expect(resolveTaskFte({ ...base, declared: 6 })).toBe(6);
  });

  it("без заявленной занятости считает по нормативу", () => {
    expect(resolveTaskFte({ ...base, declared: undefined })).toBeCloseTo(6.25, 5);
  });

  it("норматив не может дать больше людей, чем есть на объекте", () => {
    // С делителем 12 500 (нынешнее глобальное допущение) предел выходит 300 человек при штате
    // 80. Именно это и давало «паллетайзер за $12 143 замещает весь пищевой комбинат».
    expect(resolveTaskFte({ ...base, workerOutputPerYear: 12_500, declared: undefined })).toBe(80);
  });

  it("без заявленной занятости и без норматива возвращает null", () => {
    // null — это НЕ ноль. Ноль означал бы «этой задачей никто не занят, экономить нечего»;
    // null означает «мы не знаем», и вызывающий обязан отказаться считать, а не показать ноль.
    expect(resolveTaskFte({ ...base, workerOutputPerYear: null, declared: undefined })).toBeNull();
  });

  it("заявленный ноль — это ответ, а не пропуск", () => {
    // Человек может честно сказать «этой задачей у нас никто не занят». Откат к нормативу
    // здесь означал бы, что мы не поверили его ответу и подставили свой.
    expect(resolveTaskFte({ ...base, declared: 0 })).toBe(0);
  });

  it("заявленная занятость ограничена штатом объекта", () => {
    expect(resolveTaskFte({ ...base, declared: 500 })).toBe(80);
  });

  it("негодная заявленная занятость откатывается к нормативу, а не роняет расчёт", () => {
    // Та же логика, что у переопределений количества и цены: негодное значение не переносится
    // и не «чинится». Расчёт возвращается к нормативу, и пометка «задано вами» исчезает вместе
    // с ним — экран не утверждает того, чего движок не делает.
    for (const bad of [NaN, Infinity, -1]) {
      expect(resolveTaskFte({ ...base, declared: bad }), `declared=${bad}`).toBeCloseTo(6.25, 5);
    }
  });

  it("вырожденные входы не дают ни Infinity, ни NaN", () => {
    expect(resolveTaskFte({ ...base, demandPerYear: 0, declared: undefined })).toBe(0);
    expect(resolveTaskFte({ ...base, workerOutputPerYear: 0, declared: undefined })).toBeNull();
    expect(resolveTaskFte({ ...base, demandPerYear: NaN, declared: undefined })).toBeNull();
    expect(resolveTaskFte({ ...base, staffCount: 0, declared: undefined })).toBe(0);
    expect(resolveTaskFte({ ...base, staffCount: NaN, declared: 6 })).toBe(0);
  });
});
