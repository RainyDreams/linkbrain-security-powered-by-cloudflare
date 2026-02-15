-- schema.sql

-- 1. Cleanup
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS holdings;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS meta;
DROP TABLE IF EXISTS bank_transfers;
DROP TABLE IF EXISTS login_attempts;

-- 2. Account
CREATE TABLE account (
    id INTEGER PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    frozen_balance INTEGER NOT NULL DEFAULT 0 CHECK (frozen_balance >= 0),
    initial_capital INTEGER NOT NULL CHECK (initial_capital >= 0),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Holdings
CREATE TABLE holdings (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    available_qty INTEGER NOT NULL DEFAULT 0 CHECK (available_qty >= 0 AND available_qty <= quantity),
    avg_cost INTEGER NOT NULL CHECK (avg_cost >= 0),
    total_cost INTEGER NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Orders
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price INTEGER NOT NULL CHECK (price > 0),
    qty INTEGER NOT NULL CHECK (qty > 0),
    filled_qty INTEGER NOT NULL DEFAULT 0 CHECK (filled_qty >= 0 AND filled_qty <= qty),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'MATCHING', 'FILLED', 'PARTIAL', 'CANCELLED', 'EXPIRED', 'ERROR')),
    freeze_amount INTEGER NOT NULL DEFAULT 0 CHECK (freeze_amount >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);

-- 5. Trades
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    symbol TEXT,
    name TEXT,
    side TEXT CHECK (side IN ('BUY', 'SELL')),
    price INTEGER CHECK (price > 0),
    qty INTEGER CHECK (qty > 0),
    amount INTEGER CHECK (amount >= 0),
    commission INTEGER CHECK (commission >= 0),
    tax INTEGER CHECK (tax >= 0),
    pre_pos_ratio REAL,
    post_pos_ratio REAL,
    trade_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_trades_order ON trades(order_id);
CREATE INDEX idx_trades_time ON trades(trade_time);

-- 6. Daily snapshots
CREATE TABLE snapshots (
    date TEXT PRIMARY KEY,
    total_assets INTEGER NOT NULL DEFAULT 0 CHECK (total_assets >= 0),
    day_pnl INTEGER NOT NULL DEFAULT 0,
    total_return_rate REAL NOT NULL DEFAULT 0,
    max_drawdown REAL NOT NULL DEFAULT 0
);

-- 7. Comments
CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL DEFAULT 'Guest',
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. Bank transfer logs (idempotency + audit)
CREATE TABLE bank_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    cst_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SUCCESS', 'FAILED')),
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
);
CREATE INDEX idx_bank_transfers_date ON bank_transfers(cst_date, status);

-- 9. Login attempt rate-limit
CREATE TABLE login_attempts (
    ip TEXT PRIMARY KEY,
    fail_count INTEGER NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
    first_fail_at TEXT,
    locked_until TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. Meta
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. Seed data
INSERT INTO account (id, balance, frozen_balance, initial_capital)
VALUES (1, 100000000, 0, 100000000);

INSERT INTO snapshots (date, total_assets, day_pnl, total_return_rate, max_drawdown)
VALUES (DATE('now', '-1 day'), 100000000, 0, 0, 0);

