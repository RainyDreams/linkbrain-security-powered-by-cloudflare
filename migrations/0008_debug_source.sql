-- migrations/0008_debug_source.sql
-- 为订单和成交表添加 source 字段，区分真实交易和调试模拟交易。
--   'real'      = 真实下单（默认）
--   'debug'     = 管理员在调试模式下的模拟下单（不参与公开看板统计）
--   'simulated' = matchOrders 强制撮合触发的成交（非调试入口，但保留标记以便审计）

ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'real'
    CHECK (source IN ('real', 'debug', 'simulated'));

ALTER TABLE trades ADD COLUMN source TEXT NOT NULL DEFAULT 'real'
    CHECK (source IN ('real', 'debug', 'simulated'));

CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
CREATE INDEX IF NOT EXISTS idx_trades_source ON trades(source);