import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository, SaveResult } from "../repositories/orders.js";
import { parsePercent, parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  // Появились в API недавно: у старых заказов их нет
  discountPercent: z.union([z.number(), z.string()]).optional(),
  amountPaid: z.union([z.number(), z.string()]).optional(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Фактически оплаченная сумма в копейках.
 * Источник правды - amountPaid (так считает платёжная система); если его нет,
 * а скидка есть - считаем из скидки; если нет ни того, ни другого - null (без скидки).
 */
function paidKop(amountKop: number, amountPaid: unknown, discountPercent: unknown): number | null {
  const percent = discountPercent === undefined ? null : parsePercent(discountPercent);
  let paid: number;
  if (amountPaid !== undefined) paid = toKop(parseRub(amountPaid));
  else if (percent !== null) paid = Math.round((amountKop * (100 - percent)) / 100);
  else return null;
  if (paid > amountKop) throw new Error(`amountPaid ${JSON.stringify(amountPaid)} is greater than amount`);
  return paid;
}

export type ApplyResult = SaveResult;

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        amountPaidKop: paidKop(amountKop, o.amountPaid, o.discountPercent),
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами и не по порядку, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt).
   * Вебхуки бывают параллельными (несколько запросов в одну миллисекунду).
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    // Сравнение версий - атомарно в самом UPSERT, см. OrdersRepository.save
    return this.orders.save(this.normalize(raw));
  }
}
