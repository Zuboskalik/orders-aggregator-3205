import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 500, gross: 500, discount: 0, net: 500 }]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 800, gross: 800, discount: 0, net: 800 }]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });

  it("скидки: gross, net, discount; total = gross", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 2000, discountPercent: 15, amountPaid: 1700 }));
    await postWebhook(ctx.app, apiOrder({ amount: "500.00", discountPercent: "17.5", amountPaid: 412.5 }));
    await postWebhook(ctx.app, apiOrder({ amount: 4870, discountPercent: 3, amountPaid: 4723.9 })); // float: 472389.999...
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 7370, gross: 7370, discount: 533.6, net: 6836.4 }]);
  });

  it("заказ без полей скидки (старые данные API) - без скидки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 0, amountPaid: 1000 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 2000, gross: 2000, discount: 0, net: 2000 }]);
  });

  it("только discountPercent без amountPaid - net считается из скидки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 999, discountPercent: 33 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 999, gross: 999, discount: 329.67, net: 669.33 }]);
  });

  it("мусор в полях скидки - заказ невалиден", async () => {
    expect((await postWebhook(ctx.app, apiOrder({ discountPercent: "abc", amountPaid: 900 }))).statusCode).toBe(400);
    expect((await postWebhook(ctx.app, apiOrder({ amount: 1000, amountPaid: 1500 }))).statusCode).toBe(400);
    expect((await postWebhook(ctx.app, apiOrder({ discountPercent: 150 }))).statusCode).toBe(400);
  });

  it("дни режутся по местной полуночи и до, и после перехода на летнее время", async () => {
    // c_7 - Europe/Berlin: до 29.03 UTC+1, после - UTC+2.
    // Раньше смещение бралось на "сейчас" для всех заказов, и одна из половин всегда съезжала на день.
    ctx.api.customers.set("c_7", "Europe/Berlin");
    const o = (createdAt: string, amount: number) => apiOrder({ customerId: "c_7", amount, createdAt, updatedAt: createdAt });
    await postWebhook(ctx.app, o("2026-03-27T22:30:00Z", 1)); // 23:30 27-го
    await postWebhook(ctx.app, o("2026-03-27T23:30:00Z", 10)); // 00:30 28-го
    await postWebhook(ctx.app, o("2026-03-30T21:30:00Z", 100)); // 23:30 30-го
    await postWebhook(ctx.app, o("2026-03-30T22:30:00Z", 1000)); // 00:30 31-го
    const res = await dailyTotals(ctx.app, "c_7", "2026-03-27", "2026-03-31");
    expect(res.json().map((d: { date: string; total: number }) => [d.date, d.total])).toEqual([
      ["2026-03-27", 1],
      ["2026-03-28", 10],
      ["2026-03-29", 0],
      ["2026-03-30", 100],
      ["2026-03-31", 1000],
    ]);
  });
});
