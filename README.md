# orders-aggregator-3205

Решение тестового задания "сервис статистики заказов" (сервис `orders-aggregator`).
Условие - `TASK.md`, подробный отчёт - `SOLUTION.md`, ответ для `c_7` - `result.json`.
Описание сервиса, его API и API внешней системы - ниже, в разделе "Сервис".

## Что сделано

- **Скидки в статистике.** `GET /customers/:id/daily-totals` отдаёт по дням `{ date, total, gross, discount, net }`:
  - `gross` (= `total`) - сумма оплаченных заказов до скидки, `net` - фактически оплачено, `discount = gross - net`;
  - `net` берётся из `amountPaid`, без него - из `discountPercent`, без обоих (заказы до 15.03.2026) - без скидки;
  - миграция `002_amount_paid.sql`, старые заказы дозаполняются повторным `POST /sync`.
- **Жалоба по `c_7` (27-31.03).** Причина - переход на летнее время в `Europe/Berlin` 29.03:
  смещение таймзоны бралось на момент запроса, а не на момент заказа, и заказы около полуночи 29-31.03
  попадали в соседний день. Теперь смещение считается для каждого заказа.
- **Попутно исправлено:**
  - `toKop` терял копейку на погрешности float (`4723.9 * 100 = 472389.999...`);
  - гонка на параллельных вебхуках: старая версия заказа могла перетереть новую - сравнение версий перенесено в атомарный UPSERT.
- **Тесты:** DST, скидки, невалидные поля скидки, параллельные вебхуки, дозаполнение, копейки - всего 39, все проходят.

## Как проверить

Нужны Docker и Node 20+. Образы внешнего API (`orders-mock-*.tar.gz`) в репозиторий не входят - они из архива задания:

```bash
docker load -i orders-mock-amd64.tar.gz   # или arm64, путь к архиву из задания
cp .env.example .env
docker compose up -d
npm install
npm test                 # 39 тестов
npm run typecheck
```

Воспроизвести `result.json` (чистая БД):

```bash
docker compose down -v && docker compose up -d
npm run dev                                   # в отдельном терминале, http://localhost:3000
curl -X POST localhost:3000/sync              # ждать ответа (несколько минут)
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
curl "localhost:3000/customers/c_7/daily-totals?from=2026-03-27&to=2026-03-31"
```

Ожидаемый ответ:

| день | gross (= total) | discount | net |
|---|---|---|---|
| 2026-03-27 | 24736 | 4880.49 | 19855.51 |
| 2026-03-28 | 58233 | 3941.81 | 54291.19 |
| 2026-03-29 | 34658 | 2698.35 | 31959.65 |
| 2026-03-30 | 59684 | 10673.24 | 49010.76 |
| 2026-03-31 | 35401 | 5613.45 | 29787.55 |

Эти суммы сверены с независимым расчётом по сырой выгрузке API и перехваченным вебхукам - совпадают до копейки.
Старый код давал другие суммы за 29-31.03 (43964 / 52201 / 44064 вместо 34658 / 59684 / 35401).

## Сервис

Сервис забирает заказы интернет-магазина из внешней системы (API поддерживает другая команда),
принимает их обновления через вебхуки и считает статистику по клиентам.

### Стек

Node 20+, TypeScript, Fastify, PostgreSQL (`pg`), Zod, Vitest.

### Запуск

Образ внешнего API - из архива задания, загрузите тот, что под вашу архитектуру (`uname -m`):

```bash
docker load -i orders-mock-arm64.tar.gz     # arm64 / aarch64 (Mac на Apple Silicon)
docker load -i orders-mock-amd64.tar.gz     # x86_64
```

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL (+ тестовая БД orders_test) и внешний API на :4000
npm install
npm run migrate
npm run dev                 # http://localhost:3000
```

Отправка вебхуков из внешней системы (для разработки запускается вручную, сервис должен быть запущен):

```bash
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
```

Тесты (нужен запущенный PostgreSQL):

```bash
npm test
```

### Структура

```
src/
  app.ts              Fastify-приложение, обработка ошибок
  container.ts        сборка зависимостей
  db.ts               пул соединений, миграции
  clients/            клиент внешнего API (лимиты, ретраи)
  repositories/       доступ к данным
  services/           бизнес-логика
  routes/             HTTP-слой
  utils/              деньги, время
migrations/           SQL-миграции, применяются по порядку
test/                 интеграционные тесты на реальной БД (внешний API — фейк)
```

### Соглашения

- Деньги внутри сервиса — в копейках (integer). Рубли — только на входе из внешнего API и в ответах.
- Время храним в UTC (`TIMESTAMPTZ`).
- Ошибки бизнес-логики — наследники `AppError`, в ответе `{ error: <код>, message }`.

### API сервиса

| Метод | Путь | Описание |
|---|---|---|
| POST | `/sync` | Забрать все заказы из внешнего API. Отвечает статистикой, когда всё забрано |
| POST | `/webhooks/order` | Обновление заказа (тело — `Order` внешнего API). Повтор/устаревшая версия → `200 { result: "stale" }` |
| GET | `/customers/:id/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Суммы оплаченных (`paid`) заказов по дням в таймзоне клиента: `[{ date, total, gross, discount, net }]` (`total` = `gross` - до скидки, `net` - фактически оплачено, `discount` = `gross - net`) |
| GET | `/health` | Проверка живости |

### Внешний API (`ORDERS_API_URL`)

- `GET /orders?cursor=<string>&limit=<1..100>` → `{ items: Order[], nextCursor: string | null }`. Лимит 5 rps.
- `GET /customers/:id` → `{ id, timezone }` (IANA, например `Europe/Berlin`).
- Вебхуки: `POST` на наш `/webhooks/order`, тело — `Order`. Повторная доставка возможна.

```ts
type Order = {
  id: string;
  customerId: string;
  amount: number;          // сумма заказа в рублях, до скидки
  discountPercent: number; // скидка, % (0 — без скидки)
  amountPaid: number;      // оплачено, в рублях: amount со скидкой
  status: "pending" | "paid" | "refunded";
  createdAt: string;       // ISO 8601, UTC
  updatedAt: string;       // ISO 8601, UTC
};
```

`discountPercent` и `amountPaid` появились в API недавно (у заказов до 15.03.2026 их нет). `net` в статистике берётся из `amountPaid`; если его нет - из `discountPercent`; если нет обоих - заказ считается без скидки.
