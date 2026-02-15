let schemaReady = false;
let schemaReadyPromise = null;

export const ensureRuntimeSchema = async (env) => {
    if (schemaReady) return;
    if (schemaReadyPromise) return schemaReadyPromise;

    schemaReadyPromise = (async () => {
        await env.DB.batch([
            env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `),
            env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS login_attempts (
                    ip TEXT PRIMARY KEY,
                    fail_count INTEGER NOT NULL DEFAULT 0,
                    first_fail_at TEXT,
                    locked_until TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `),
            env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS bank_transfers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT NOT NULL UNIQUE,
                    type TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    cst_date TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reason TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    processed_at DATETIME
                )
            `),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bank_transfers_date ON bank_transfers(cst_date, status)')
        ]);

        schemaReady = true;
    })();

    try {
        await schemaReadyPromise;
    } finally {
        schemaReadyPromise = null;
    }
};
