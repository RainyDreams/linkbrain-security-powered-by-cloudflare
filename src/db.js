let schemaReady = false;
let schemaReadyPromise = null;
let schemaLastResult = {
    added_columns: [],
    cst_backfilled_tables: []
};

const COMPAT_COLUMN_SPECS = Object.freeze({
    account: [
        { name: 'frozen_balance', ddl: "frozen_balance INTEGER NOT NULL DEFAULT 0" },
        { name: 'initial_capital', ddl: "initial_capital INTEGER NOT NULL DEFAULT 0" },
        { name: 'updated_at', ddl: "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" }
    ],
    holdings: [
        { name: 'name', ddl: "name TEXT" },
        { name: 'available_qty', ddl: "available_qty INTEGER NOT NULL DEFAULT 0" },
        { name: 'total_cost', ddl: "total_cost INTEGER NOT NULL DEFAULT 0" },
        { name: 'updated_at', ddl: "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" }
    ],
    orders: [
        { name: 'filled_qty', ddl: "filled_qty INTEGER NOT NULL DEFAULT 0" },
        { name: 'status', ddl: "status TEXT NOT NULL DEFAULT 'PENDING'" },
        { name: 'freeze_amount', ddl: "freeze_amount INTEGER NOT NULL DEFAULT 0" },
        { name: 'remark', ddl: "remark TEXT NOT NULL DEFAULT ''" },
        { name: 'strategy_tag', ddl: "strategy_tag TEXT NOT NULL DEFAULT ''" },
        { name: 'updated_at', ddl: "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" }
    ],
    trades: [
        { name: 'amount', ddl: "amount INTEGER" },
        { name: 'commission', ddl: "commission INTEGER" },
        { name: 'tax', ddl: "tax INTEGER" },
        { name: 'trade_time', ddl: "trade_time DATETIME DEFAULT CURRENT_TIMESTAMP" }
    ],
    bank_transfers: [
        { name: 'reason', ddl: "reason TEXT" },
        { name: 'processed_at', ddl: "processed_at DATETIME" }
    ],
    audit_technical: [
        { name: 'category', ddl: "category TEXT NOT NULL DEFAULT 'runtime'" },
        { name: 'subcategory', ddl: "subcategory TEXT NOT NULL DEFAULT ''" },
        { name: 'tags', ddl: "tags TEXT NOT NULL DEFAULT ''" },
        { name: 'status', ddl: "status TEXT NOT NULL DEFAULT ''" },
        { name: 'meta', ddl: "meta TEXT" },
        { name: 'created_at_cst', ddl: "created_at_cst TEXT NOT NULL DEFAULT ''" }
    ],
    audit_financial: [
        { name: 'category', ddl: "category TEXT NOT NULL DEFAULT 'trade'" },
        { name: 'subcategory', ddl: "subcategory TEXT NOT NULL DEFAULT ''" },
        { name: 'tags', ddl: "tags TEXT NOT NULL DEFAULT ''" },
        { name: 'status', ddl: "status TEXT NOT NULL DEFAULT 'UNKNOWN'" },
        { name: 'error_stack', ddl: "error_stack TEXT" },
        { name: 'meta', ddl: "meta TEXT" },
        { name: 'holdings_before', ddl: "holdings_before INTEGER" },
        { name: 'holdings_after', ddl: "holdings_after INTEGER" },
        { name: 'created_at_cst', ddl: "created_at_cst TEXT NOT NULL DEFAULT ''" }
    ],
    ai_committee_runs: [
        { name: 'phase', ddl: "phase TEXT" },
        { name: 'symbols', ddl: "symbols TEXT" },
        { name: 'actions_total', ddl: "actions_total INTEGER NOT NULL DEFAULT 0" },
        { name: 'executed_total', ddl: "executed_total INTEGER NOT NULL DEFAULT 0" },
        { name: 'manager_penalty', ddl: "manager_penalty INTEGER NOT NULL DEFAULT 0" },
        { name: 'president_penalty', ddl: "president_penalty INTEGER NOT NULL DEFAULT 0" },
        { name: 'pnl_day', ddl: "pnl_day INTEGER NOT NULL DEFAULT 0" },
        { name: 'detail', ddl: "detail TEXT" },
        { name: 'created_at_cst', ddl: "created_at_cst TEXT NOT NULL DEFAULT ''" }
    ],
    ai_committee_tasks: [
        { name: 'payload', ddl: "payload TEXT" },
        { name: 'result', ddl: "result TEXT" },
        { name: 'error_message', ddl: "error_message TEXT" },
        { name: 'updated_at', ddl: "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" },
        { name: 'claimed_at', ddl: "claimed_at DATETIME" },
        { name: 'finished_at', ddl: "finished_at DATETIME" },
        { name: 'created_at_cst', ddl: "created_at_cst TEXT NOT NULL DEFAULT ''" }
    ],
    ai_pending_actions: [
        { name: 'result_payload', ddl: "result_payload TEXT" },
        { name: 'reason', ddl: "reason TEXT" },
        { name: 'updated_at', ddl: "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" },
        { name: 'decided_at', ddl: "decided_at DATETIME" },
        { name: 'created_at_cst', ddl: "created_at_cst TEXT NOT NULL DEFAULT ''" }
    ],
    trade_reports: [
        { name: 'title', ddl: "title TEXT NOT NULL DEFAULT ''" },
        { name: 'summary', ddl: "summary TEXT NOT NULL DEFAULT ''" },
        { name: 'experience', ddl: "experience TEXT NOT NULL DEFAULT ''" },
        { name: 'created_by', ddl: "created_by TEXT NOT NULL DEFAULT 'manager'" },
        { name: 'source', ddl: "source TEXT NOT NULL DEFAULT 'manual'" },
        { name: 'updated_at', ddl: "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" },
        { name: 'created_at_cst', ddl: "created_at_cst TEXT NOT NULL DEFAULT ''" }
    ],
    trade_experiences: [
        { name: 'weight', ddl: "weight INTEGER NOT NULL DEFAULT 50" },
        { name: 'source', ddl: "source TEXT NOT NULL DEFAULT 'manager'" },
        { name: 'updated_at', ddl: "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" },
        { name: 'created_at_cst', ddl: "created_at_cst TEXT NOT NULL DEFAULT ''" }
    ]
});

const getTableColumns = async (env, table) => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const set = new Set();
    for (const row of results || []) {
        const name = String(row?.name || '').trim().toLowerCase();
        if (name) set.add(name);
    }
    return set;
};

const hasTable = async (env, table) => {
    const row = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
    ).bind(table).first();
    return !!row?.name;
};

const ensureCompatColumns = async (env, summary) => {
    for (const [table, specs] of Object.entries(COMPAT_COLUMN_SPECS)) {
        if (!(await hasTable(env, table))) continue;
        const columns = await getTableColumns(env, table);
        for (const spec of specs || []) {
            const name = String(spec?.name || '').trim().toLowerCase();
            if (!name || columns.has(name)) continue;
            await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${spec.ddl}`).run();
            columns.add(name);
            summary.added_columns.push(`${table}.${name}`);
        }
    }
};

const backfillCreatedAtCst = async (env, summary) => {
    const tables = [
        'audit_technical',
        'audit_financial',
        'ai_committee_runs',
        'ai_committee_tasks',
        'ai_pending_actions',
        'trade_reports',
        'trade_experiences'
    ];
    for (const table of tables) {
        if (!(await hasTable(env, table))) continue;
        const columns = await getTableColumns(env, table);
        if (!columns.has('created_at') || !columns.has('created_at_cst')) continue;
        await env.DB.prepare(`
            UPDATE ${table}
            SET created_at_cst = datetime(created_at, '+8 hours')
            WHERE (created_at_cst IS NULL OR created_at_cst = '')
              AND created_at IS NOT NULL
        `).run();
        summary.cst_backfilled_tables.push(table);
    }
};

export const withTransaction = async (env, task) => {
    // D1 Workers bindings do not allow BEGIN/COMMIT. If we are running inside
    // a Durable Object with SQLite storage, prefer its transaction API.
    const storage = env?.STATE?.storage || env?.state?.storage;
    if (storage?.transaction) {
        return await storage.transaction(async () => await task());
    }

    return await task();
};

export const ensureRuntimeSchema = async (env) => {
    if (schemaReady) return schemaLastResult;
    if (schemaReadyPromise) return schemaReadyPromise;

    schemaReadyPromise = (async () => {
        const summary = {
            added_columns: [],
            cst_backfilled_tables: []
        };
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
                    type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
                    amount INTEGER NOT NULL CHECK (amount > 0),
                    cst_date TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'SUCCESS', 'FAILED')),
                    reason TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    processed_at DATETIME
                )
            `),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bank_transfers_date ON bank_transfers(cst_date, status)'),
            env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS audit_technical (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    level TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'runtime',
                    subcategory TEXT NOT NULL DEFAULT '',
                    tags TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT '',
                    order_id INTEGER,
                    symbol TEXT,
                    request_id TEXT,
                    message TEXT,
                    stack TEXT,
                    meta TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at_cst TEXT NOT NULL
                )
            `),
            env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS audit_financial (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'trade',
                    subcategory TEXT NOT NULL DEFAULT '',
                    tags TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    order_id INTEGER,
                    symbol TEXT,
                    request_id TEXT,
                    side TEXT,
                    qty INTEGER,
                    price INTEGER,
                    amount INTEGER,
                    fee INTEGER NOT NULL DEFAULT 0,
                    tax INTEGER NOT NULL DEFAULT 0,
                    freeze_before INTEGER,
                    freeze_after INTEGER,
                    available_before INTEGER,
                    available_after INTEGER,
                    balance_before INTEGER,
                    balance_after INTEGER,
                    holdings_before INTEGER,
                    holdings_after INTEGER,
                    message TEXT,
                    error_stack TEXT,
                    meta TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at_cst TEXT NOT NULL
                )
            `),
            env.DB.prepare(`
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
                )
            `),
            env.DB.prepare(`
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
                )
            `),
            env.DB.prepare(`
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
                )
            `),
            env.DB.prepare(`
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
                )
            `),
            env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS trade_experiences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL,
                    weight INTEGER NOT NULL DEFAULT 50 CHECK (weight >= 0 AND weight <= 100),
                    source TEXT NOT NULL DEFAULT 'manager',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at_cst TEXT NOT NULL
                )
            `),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_tech_time ON audit_technical(created_at_cst DESC)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_tech_scope ON audit_technical(scope, status)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_tech_order ON audit_technical(order_id, symbol, request_id)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_fin_time ON audit_financial(created_at_cst DESC)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_fin_scope ON audit_financial(scope, status)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_fin_order ON audit_financial(order_id, symbol, request_id)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_fin_amount ON audit_financial(amount, fee, tax)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ai_committee_runs_time ON ai_committee_runs(created_at_cst DESC)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ai_committee_runs_status ON ai_committee_runs(status, trigger)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ai_committee_tasks_status ON ai_committee_tasks(status, id)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ai_committee_tasks_time ON ai_committee_tasks(created_at_cst DESC)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_status ON ai_pending_actions(status, id)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_run ON ai_pending_actions(run_id, status)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_time ON ai_pending_actions(created_at_cst DESC)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_trade_reports_period ON trade_reports(period_type, period_key, id DESC)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_trade_reports_time ON trade_reports(created_at_cst DESC)'),
            env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_trade_experiences_time ON trade_experiences(created_at_cst DESC)')
        ]);

        await ensureCompatColumns(env, summary);
        await backfillCreatedAtCst(env, summary);

        schemaLastResult = summary;
        schemaReady = true;
        return summary;
    })();

    try {
        return await schemaReadyPromise;
    } finally {
        schemaReadyPromise = null;
    }
};
