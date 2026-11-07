import type { Db } from "../db.js";

export interface Order {
  id: string;
  customerId: string;
  /** сумма до скидки */
  amountKop: number;
  /** фактически оплачено (со скидкой); null - неизвестно, считаем без скидки */
  amountPaidKop: number | null;
  status: "pending" | "paid" | "refunded";
  createdAt: Date;
  updatedAt: Date;
}

export type SaveResult = "created" | "updated" | "stale";

interface Row {
  id: string;
  customer_id: string;
  amount_kop: string;
  amount_paid_kop: string | null;
  status: Order["status"];
  created_at: Date;
  updated_at: Date;
}

const fromRow = (r: Row): Order => ({
  id: r.id,
  customerId: r.customer_id,
  amountKop: Number(r.amount_kop),
  amountPaidKop: r.amount_paid_kop === null ? null : Number(r.amount_paid_kop),
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Order | null> {
    const { rows } = await this.db.query<Row>(`SELECT * FROM orders WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  /**
   * Сохраняет версию заказа, только если она новее сохранённой (по updated_at).
   * Проверка - в том же UPSERT, атомарно: параллельные вебхуки одного заказа
   * не могут перетереть новую версию старой (read-then-write в коде давал гонку).
   *
   * Исключение - та же версия, в которой появилась оплаченная сумма, а у нас её нет
   * (заказ сохранён до появления скидок в API): дозаполняем при повторном /sync.
   */
  async save(o: Order): Promise<SaveResult> {
    const { rows } = await this.db.query<{ inserted: boolean }>(
      `INSERT INTO orders (id, customer_id, amount_kop, amount_paid_kop, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         customer_id     = excluded.customer_id,
         amount_kop      = excluded.amount_kop,
         amount_paid_kop = excluded.amount_paid_kop,
         status          = excluded.status,
         created_at      = excluded.created_at,
         updated_at      = excluded.updated_at
       WHERE orders.updated_at < excluded.updated_at
          OR (orders.updated_at = excluded.updated_at
              AND orders.amount_paid_kop IS NULL AND excluded.amount_paid_kop IS NOT NULL)
       RETURNING (xmax = 0) AS inserted`,
      [o.id, o.customerId, o.amountKop, o.amountPaidKop, o.status, o.createdAt, o.updatedAt],
    );
    if (rows.length === 0) return "stale";
    return rows[0].inserted ? "created" : "updated";
  }

  /** Оплаченные заказы клиента, созданные в [from, to). */
  async paidCreatedBetween(customerId: string, from: Date, to: Date): Promise<Order[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM orders
        WHERE customer_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
      [customerId, from, to],
    );
    return rows.map(fromRow);
  }
}
