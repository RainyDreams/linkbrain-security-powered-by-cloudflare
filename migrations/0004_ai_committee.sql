CREATE TABLE IF NOT EXISTS ai_committee_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT,
    symbols TEXT,
    actions_total INTEGER NOT NULL DEFAULT 0,
    executed_total INTEGER NOT NULL DEFAULT 0,
    manager_penalty INTEGER NOT NULL DEFAULT 0,
    president_penalty INTEGER NOT NULL DEFAULT 0,
    pnl_day INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at_cst TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_committee_runs_time ON ai_committee_runs(created_at_cst DESC);
CREATE INDEX IF NOT EXISTS idx_ai_committee_runs_status ON ai_committee_runs(status, trigger);
