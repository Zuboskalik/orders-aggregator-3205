import { describe, expect, it } from "vitest";
import { fromKop, parsePercent, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("не теряет копейку на погрешности float", () => {
    // 4723.9 * 100 = 472389.99999999994 - раньше floor давал 472389
    expect(toKop(4723.9)).toBe(472390);
    expect(toKop(1217.61)).toBe(121761);
    expect(toKop(0.29)).toBe(29);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});

describe("parsePercent", () => {
  it("число и строка в диапазоне 0..100", () => {
    expect(parsePercent(15)).toBe(15);
    expect(parsePercent("33")).toBe(33);
    expect(parsePercent(0)).toBe(0);
  });

  it("отклоняет мусор и выход за диапазон", () => {
    expect(() => parsePercent("abc")).toThrow();
    expect(() => parsePercent(-1)).toThrow();
    expect(() => parsePercent(101)).toThrow();
  });
});
