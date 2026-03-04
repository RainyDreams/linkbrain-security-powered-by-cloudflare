ALTER TABLE orders ADD COLUMN remark TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN strategy_tag TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS trade_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type TEXT NOT NULL CHECK (period_type IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    period_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    experience TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'manager',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at_cst TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_reports_period ON trade_reports(period_type, period_key, id DESC);
CREATE INDEX IF NOT EXISTS idx_trade_reports_time ON trade_reports(created_at_cst DESC);

CREATE TABLE IF NOT EXISTS trade_experiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 50 CHECK (weight >= 0 AND weight <= 100),
    source TEXT NOT NULL DEFAULT 'manager',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at_cst TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_experiences_time ON trade_experiences(created_at_cst DESC);
