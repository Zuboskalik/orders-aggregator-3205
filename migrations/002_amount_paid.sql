-- Фактически оплаченная сумма (со скидкой), в копейках.
-- NULL - неизвестна: заказ сохранён до появления скидок в API или API её не прислал.
-- В статистике NULL считается как "без скидки" (= amount_kop).
-- Уже сохранённые заказы дозаполнятся при следующем /sync: см. OrdersRepository.save.
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT CHECK (amount_paid_kop >= 0);
