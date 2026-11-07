import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { dateInZone, datesBetween } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

export interface DailyTotal {
  date: string;
  /** = gross, оставлено для обратной совместимости */
  total: number;
  /** сумма оплаченных заказов до скидки */
  gross: number;
  /** gross - net */
  discount: number;
  /** фактически оплачено */
  net: number;
}

const DAY = 86_400_000;

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Суммы оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат - с нулями.
   */
  async daily(customerId: string, from: string, to: string): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);

    // Смещения таймзон в пределах ±14 ч: берём с запасом в сутки с каждой стороны
    const rows = await this.orders.paidCreatedBetween(
      customerId,
      new Date(Date.parse(`${from}T00:00:00Z`) - DAY),
      new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY),
    );

    const sums = new Map(datesBetween(from, to).map((d) => [d, { gross: 0, net: 0 }]));
    for (const o of rows) {
      // Смещение - на момент заказа, а не на "сейчас": иначе дни после перехода
      // на летнее/зимнее время (DST) режутся не по местной полуночи
      const cur = sums.get(dateInZone(o.createdAt, timezone));
      if (!cur) continue;
      cur.gross += o.amountKop;
      cur.net += o.amountPaidKop ?? o.amountKop;
    }
    return [...sums].map(([date, { gross, net }]) => ({
      date,
      total: fromKop(gross),
      gross: fromKop(gross),
      discount: fromKop(gross - net),
      net: fromKop(net),
    }));
  }
}
