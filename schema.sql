-- schema.sql

-- 1. 清理
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS holdings;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS meta;

-- 2. 账户表
CREATE TABLE account (
    id INTEGER PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,        -- 可用余额 (分)
    frozen_balance INTEGER DEFAULT 0,          -- 冻结金额 (分)
    initial_capital INTEGER NOT NULL,          -- 初始本金 (分)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 持仓表
CREATE TABLE holdings (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,       -- 总持仓
    available_qty INTEGER NOT NULL DEFAULT 0,  -- 可卖持仓 (T+1)
    avg_cost INTEGER NOT NULL,                 -- 持仓均价 (分)
    total_cost INTEGER DEFAULT 0,              -- 总持仓成本 (分)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. 订单表
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT,
    side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
    price INTEGER NOT NULL,                    -- 委托价格 (分)
    qty INTEGER NOT NULL,                      -- 委托数量
    filled_qty INTEGER DEFAULT 0,              -- 已成交数量
    status TEXT DEFAULT 'PENDING',             -- PENDING, FILLED, PARTIAL, CANCELLED, EXPIRED
    freeze_amount INTEGER DEFAULT 0,           -- 冻结金额(买入时)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);

-- 5. 成交流水
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    symbol TEXT,
    name TEXT,
    side TEXT,
    price INTEGER,                             -- 成交均价 (分)
    qty INTEGER,
    amount INTEGER,                            -- 成交金额 (分)
    commission INTEGER,
    tax INTEGER,
    pre_pos_ratio REAL,                        -- 交易前仓位 %
    post_pos_ratio REAL,                       -- 交易后仓位 %
    trade_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. 快照表 (用于走势图)
CREATE TABLE snapshots (
    date TEXT PRIMARY KEY,                     -- YYYY-MM-DD
    total_assets INTEGER,                      -- 总资产 (分)
    day_pnl INTEGER,                           -- 当日盈亏 (分)
    total_return_rate REAL,                    -- 累计收益率 %
    max_drawdown REAL                          -- 历史最大回撤 %
);

-- 7. 评论区
CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT DEFAULT 'Guest',
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. 初始化
INSERT INTO account (id, balance, initial_capital) VALUES (1, 100000000, 100000000); -- 100万
INSERT INTO snapshots (date, total_assets, day_pnl, total_return_rate, max_drawdown) 
VALUES (DATE('now', '-1 day'), 100000000, 0, 0, 0); -- 插入一条昨日假数据方便计算当日盈亏