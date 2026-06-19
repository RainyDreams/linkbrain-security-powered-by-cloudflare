-- migrations/0009_cleanup_debug_data.sql
-- 清理历史调试模式产生的数据。
-- 通过 audit_financial.order_id 字段（order_id 直接列在表里）+ scope='debug.match' 联合识别。
-- 注意：D1 远程 DDL/DML 单条执行，整个 migration 文件为一个事务。

-- 1) 找出所有调试 order_id
--    a) 通过 audit_financial scope='debug.match' 的 order_id 字段
CREATE TEMP TABLE IF NOT EXISTS _debug_orders (order_id INTEGER PRIMARY KEY);

INSERT OR IGNORE INTO _debug_orders (order_id)
SELECT DISTINCT order_id FROM audit_financial
WHERE scope = 'debug.match' AND order_id IS NOT NULL;

--    b) 通过 message 含 'debug simulate' / 'debug settle' / 'manual replay' 的 order_id
INSERT OR IGNORE INTO _debug_orders (order_id)
SELECT DISTINCT order_id FROM audit_financial
WHERE (message LIKE '%debug simulate%' OR message LIKE '%debug settle%' OR message LIKE '%manual replay%')
  AND order_id IS NOT NULL;

--    c) 通过 meta 中有 "synthetic":true 标记（仅 debug 模式会用）
INSERT OR IGNORE INTO _debug_orders (order_id)
SELECT DISTINCT order_id FROM audit_financial
WHERE json_extract(meta, '$.synthetic') = 1
  AND order_id IS NOT NULL;

-- 2) 标记调试 orders 为 source='debug'
UPDATE orders SET source = 'debug' WHERE id IN (SELECT order_id FROM _debug_orders);

-- 3) 计算调试 trades 的 balance_delta 和 holding_impact
CREATE TEMP TABLE IF NOT EXISTS _debug_trade_impact AS
SELECT
    SUM(CASE WHEN side = 'BUY' THEN -(amount + commission)
             WHEN side = 'SELL' THEN (amount - commission - tax)
             ELSE 0 END) AS balance_delta
FROM trades
WHERE order_id IN (SELECT order_id FROM _debug_orders);

-- 3.1) 标记调试 trades
UPDATE trades SET source = 'debug' WHERE order_id IN (SELECT order_id FROM _debug_orders);

-- 4) 撤销 account.balance
UPDATE account
SET balance = balance - IFNULL((SELECT balance_delta FROM _debug_trade_impact), 0),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- 5) 撤销 account.frozen_balance
UPDATE account
SET frozen_balance = IFNULL(
    (SELECT IFNULL(SUM(freeze_amount), 0) FROM orders WHERE status = 'PENDING' AND (source IS NULL OR source != 'debug')),
    0
),
updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- 6) 撤销 holdings
CREATE TEMP TABLE IF NOT EXISTS _debug_holding_impact AS
SELECT
    symbol,
    SUM(CASE WHEN side = 'BUY' THEN qty ELSE -qty END) AS qty_delta,
    SUM(CASE WHEN side = 'BUY' THEN (amount + commission)
             WHEN side = 'SELL' THEN -(amount - commission - tax)
             ELSE 0 END) AS cost_delta
FROM trades
WHERE order_id IN (SELECT order_id FROM _debug_orders)
GROUP BY symbol;

UPDATE holdings
SET
    quantity = MAX(0, quantity - IFNULL((SELECT qty_delta FROM _debug_holding_impact WHERE symbol = holdings.symbol), 0)),
    available_qty = MAX(0, available_qty - IFNULL((SELECT qty_delta FROM _debug_holding_impact WHERE symbol = holdings.symbol), 0)),
    total_cost = MAX(0, total_cost - IFNULL((SELECT cost_delta FROM _debug_holding_impact WHERE symbol = holdings.symbol), 0)),
    avg_cost = CASE
        WHEN (quantity - IFNULL((SELECT qty_delta FROM _debug_holding_impact WHERE symbol = holdings.symbol), 0)) > 0
        THEN ROUND((total_cost - IFNULL((SELECT cost_delta FROM _debug_holding_impact WHERE symbol = holdings.symbol), 0))
                  / (quantity - IFNULL((SELECT qty_delta FROM _debug_holding_impact WHERE symbol = holdings.symbol), 0)))
        ELSE 0
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE symbol IN (SELECT symbol FROM _debug_holding_impact);

-- 7) 删除 quantity=0 的 holdings
DELETE FROM holdings WHERE quantity <= 0;

-- 8) 删除调试 trades
DELETE FROM trades WHERE order_id IN (SELECT order_id FROM _debug_orders);

-- 9) 清理临时表
DROP TABLE _debug_orders;
DROP TABLE _debug_trade_impact;
DROP TABLE _debug_holding_impact;