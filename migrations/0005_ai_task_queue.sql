CREATE TABLE IF NOT EXISTS ai_committee_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
    payload TEXT,
    result TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    claimed_at DATETIME,
    finished_at DATETIME,
    created_at_cst TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_committee_tasks_status ON ai_committee_tasks(status, id);
CREATE INDEX IF NOT EXISTS idx_ai_committee_tasks_time ON ai_committee_tasks(created_at_cst DESC);
