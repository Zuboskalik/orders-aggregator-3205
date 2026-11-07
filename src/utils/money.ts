/**
 * Деньги внутри сервиса - целые копейки. Рубли - только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Процент скидки из внешнего API: число или строка с числом, 0..100. */
export function parsePercent(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid discountPercent: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Рубли - копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем.
 * Сначала гасим погрешность float (4723.9 * 100 = 472389.99999999994),
 * иначе floor съедает целую копейку у суммы, которая точна до копейки.
 */
export function toKop(rub: number): number {
  return Math.floor(Math.round(rub * 1_000_000) / 10_000);
}

/** Копейки - рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
