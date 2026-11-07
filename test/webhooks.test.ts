import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });

  it("параллельные вебхуки одного заказа: остаётся самая новая версия", async () => {
    for (let i = 0; i < 20; i++) {
      const o = apiOrder({ status: "pending", updatedAt: "2026-02-10T12:00:00Z" });
      const newest = { ...o, status: "refunded", updatedAt: "2026-02-10T14:00:00Z" };
      const older = { ...o, status: "paid", updatedAt: "2026-02-10T13:00:00Z" };
      const results = await Promise.all([postWebhook(ctx.app, newest), postWebhook(ctx.app, older), postWebhook(ctx.app, o)]);
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
      expect(rows[0].status).toBe("refunded");
    }
  });

  it("та же версия с появившейся оплаченной суммой дозаполняет заказ", async () => {
    // Заказ сохранён до появления скидок в API, затем /sync отдаёт ту же версию уже с amountPaid
    const legacy = apiOrder({ amount: 1000 });
    await postWebhook(ctx.app, legacy);
    const res = await postWebhook(ctx.app, { ...legacy, discountPercent: 10, amountPaid: 900 });
    expect(res.json()).toEqual({ result: "updated" });
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [legacy.id]);
    expect(Number(rows[0].amount_paid_kop)).toBe(90000);
    // а уже заполненную версию тот же updatedAt не меняет
    expect((await postWebhook(ctx.app, { ...legacy, discountPercent: 20, amountPaid: 800 })).json()).toEqual({ result: "stale" });
  });
});
