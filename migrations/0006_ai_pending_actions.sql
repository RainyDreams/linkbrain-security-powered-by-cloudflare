CREATE TABLE IF NOT EXISTS ai_pending_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'EXECUTED', 'REJECTED', 'FAILED')),
    action_payload TEXT NOT NULL,
    result_payload TEXT,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    decided_at DATETIME,
    created_at_cst TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_status ON ai_pending_actions(status, id);
CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_run ON ai_pending_actions(run_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_time ON ai_pending_actions(created_at_cst DESC);
