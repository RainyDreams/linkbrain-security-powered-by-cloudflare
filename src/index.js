import { signToken, verifyAuth, verifyPassword } from './auth.js';
import { placeOrder, cancelOrder, matchOrders, getPriceAssist } from './trade.js';
import { handleScheduled } from './cron.js';
import { jsonResponse, errorResponse, Money, Time, TradeRules } from './utils.js';
import { fetchStockPrice } from './market.js';
import { ensureRuntimeSchema, withTransaction } from './db.js';
import { logBizError, logError, logFinancialAudit } from './audit.js';
import {
    confirmAiPendingActions,
    getAiPendingActions,
    getAiPrompts,
    getAiRuns,
    getAiState,
    getAiTasks,
    queueAiTask,
    rejectAiPendingActions,
    runQueuedTaskById,
    setAiPrompt,
    updateAiConfig
} from './ai_committee.js';
import {
    handleDebugCleanupLogs,
    handleDebugSimulateMatch,
    handleDebugVerify,
    isDebugEnabled
} from './debug.js';

const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 30 * 60 * 1000;
const DEFAULT_INITIAL_CAPITAL_CENT = 100000000;
const RESET_CONFIRM_TEXT = 'RESET';
const SYNC_CONFIRM_TEXT = 'SYNC';
const REPORT_PERIOD_TYPES = new Set(['DAILY', 'WEEKLY', 'MONTHLY']);
const MARKET_ETF_SYMBOLS = Object.freeze([
    'sh510300', // CSI 300
    'sh510500', // CSI 500
    'sh510050', // SSE 50
    'sz159915', // ChiNext ETF
    'sh588000'  // STAR 50 ETF
]);

const getClientIp = (request) => {
    const cfIp = request.headers.get('CF-Connecting-IP');
    if (cfIp) return cfIp;
    const forwarded = request.headers.get('X-Forwarded-For');
    if (forwarded) return forwarded.split(',')[0].trim();
    return 'unknown';
};

const parseBody = async (request) => {
    try {
        return await request.json();
    } catch {
        return null;
    }
};

const asTrimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const parseJsonMaybe = (value) => {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const parseBoolMaybe = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};
const clampInt = (value, min, max) => {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
};
const sanitizeText = (value, maxLen = 1000) => String(value || '').trim().slice(0, maxLen);
const sanitizePeriodType = (value) => {
    const raw = String(value || '').trim().toUpperCase();
    return REPORT_PERIOD_TYPES.has(raw) ? raw : '';
};
const normalizeOrderStrategyTag = (value) => sanitizeText(String(value || '').toUpperCase(), 40);

const buildCurrentWeekKey = (cst = Time.getCST()) => {
    const target = new Date(cst.getTime());
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const buildPeriodKey = (periodType, inputKey = '') => {
    const custom = sanitizeText(inputKey, 32);
    if (custom) return custom;
    const cst = Time.getCST();
    if (periodType === 'DAILY') return Time.formatCSTDate(cst);
    if (periodType === 'MONTHLY') return Time.formatCSTDate(cst).slice(0, 7);
    if (periodType === 'WEEKLY') return buildCurrentWeekKey(cst);
    return Time.formatCSTDate(cst);
};

const parseJsonSafe = (value, fallback = null) => {
    try {
        if (!value || typeof value !== 'string') return fallback;
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const loadMarketEtfQuotes = async () => {
    const quotes = await Promise.all(
        MARKET_ETF_SYMBOLS.map(async (symbol) => {
            try {
                const quote = await fetchStockPrice(symbol);
                if (!quote) return null;
                const price = Number(quote.price || 0);
                const prev = Number(quote.prevClose || 0);
                const pct = prev > 0
                    ? Number((((price - prev) / prev) * 100).toFixed(2))
                    : 0;
                return {
                    symbol: quote.symbol || symbol,
                    name: quote.name || symbol,
                    price: Number(price.toFixed(2)),
                    prev_close: prev > 0 ? Number(prev.toFixed(2)) : null,
                    change_pct: pct,
                    source: quote.source || 'unknown'
                };
            } catch {
                return null;
            }
        })
    );
    return quotes.filter(Boolean);
};

const getLockState = async (env, ip) => {
    const row = await env.DB.prepare('SELECT fail_count, first_fail_at, locked_until FROM login_attempts WHERE ip=?')
        .bind(ip).first();
    if (!row) return { locked: false };

    const now = Date.now();
    const lockedUntilTs = row.locked_until ? Date.parse(row.locked_until) : 0;
    if (lockedUntilTs > now) {
        return { locked: true, remainMs: lockedUntilTs - now };
    }

    return { locked: false, row };
};

const recordLoginFailure = async (env, ip) => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const row = await env.DB.prepare('SELECT fail_count, first_fail_at FROM login_attempts WHERE ip=?').bind(ip).first();

    if (!row) {
        await env.DB.prepare(
            'INSERT INTO login_attempts (ip, fail_count, first_fail_at, locked_until, updated_at) VALUES (?, 1, ?, NULL, CURRENT_TIMESTAMP)'
        ).bind(ip, nowIso).run();
        return;
    }

    const firstTs = row.first_fail_at ? Date.parse(row.first_fail_at) : 0;
    let failCount = Number(row.fail_count || 0);
    let firstFailAt = row.first_fail_at || nowIso;

    if (!firstTs || now - firstTs > LOGIN_WINDOW_MS) {
        failCount = 1;
        firstFailAt = nowIso;
    } else {
        failCount += 1;
    }

    let lockedUntil = null;
    if (failCount >= LOGIN_MAX_FAILURES) {
        lockedUntil = new Date(now + LOGIN_LOCK_MS).toISOString();
        failCount = 0;
        firstFailAt = nowIso;
    }

    await env.DB.prepare(
        'UPDATE login_attempts SET fail_count=?, first_fail_at=?, locked_until=?, updated_at=CURRENT_TIMESTAMP WHERE ip=?'
    ).bind(failCount, firstFailAt, lockedUntil, ip).run();
};

const clearLoginFailures = async (env, ip) => {
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
};

const normalizeTransferType = (type) => String(type || '').toUpperCase();

const toCstDateTime = (value) => {
    if (!value) return null;
    const parsed = Date.parse(String(value).replace(' ', 'T') + 'Z');
    if (!Number.isFinite(parsed)) return value;
    const cst = new Date(parsed + 8 * 60 * 60 * 1000);
    const y = cst.getUTCFullYear();
    const m = String(cst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cst.getUTCDate()).padStart(2, '0');
    const hh = String(cst.getUTCHours()).padStart(2, '0');
    const mm = String(cst.getUTCMinutes()).padStart(2, '0');
    const ss = String(cst.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
};

const buildTransferResponse = (record) => ({
    request_id: record.request_id,
    type: record.type,
    status: record.status,
    amount: Money.toYuan(record.amount),
    created_at: toCstDateTime(record.created_at),
    processed_at: toCstDateTime(record.processed_at),
    reason: record.reason || null
});

const handleTransfer = async (env, body, request = null) => {
    if (!body || typeof body !== 'object') {
        return await auditErrorResponse(env, request, '参数错误', 400, 4100, {}, 'transfer');
    }

    if (!Time.isBankTransferOpen()) {
        return await auditErrorResponse(env, request, '当前不在银证转账时段（工作日 09:00-16:00）', 400, 4101, {}, 'transfer');
    }

    const type = normalizeTransferType(body.type);
    if (type !== 'IN' && type !== 'OUT') {
        return await auditErrorResponse(env, request, 'type 仅支持 IN/OUT', 400, 4102, { type }, 'transfer');
    }

    if (!Money.hasAtMostTwoDecimals(body.amount)) {
        return await auditErrorResponse(env, request, 'amount 格式非法', 400, 4103, { amount: body.amount }, 'transfer');
    }

    const amountCent = Money.toCent(body.amount);
    if (!Number.isInteger(amountCent) || amountCent <= 0) {
        return await auditErrorResponse(env, request, '金额必须大于 0', 400, 4104, { amount: body.amount }, 'transfer');
    }

    if (amountCent > TradeRules.MAX_SINGLE_TRANSFER_CENT) {
        return await auditErrorResponse(
            env,
            request,
            `单笔转账超过限制（${Money.toYuan(TradeRules.MAX_SINGLE_TRANSFER_CENT)} 元）`,
            400,
            4105,
            { amount_cent: amountCent },
            'transfer'
        );
    }

    const cstDate = Time.formatCSTDate();
    const requestIdInput = asTrimmed(body.request_id);
    const requestId = requestIdInput || crypto.randomUUID();
    if (requestId.length > 80) {
        return await auditErrorResponse(env, request, 'request_id 过长', 400, 4107, { request_id: requestId }, 'transfer');
    }

    try {
        const result = await withTransaction(env, async () => {
            const accountBefore = await env.DB.prepare('SELECT balance, frozen_balance FROM account WHERE id=1').first();
            const existing = await env.DB.prepare('SELECT * FROM bank_transfers WHERE request_id=?').bind(requestId).first();
            if (existing) {
                if (existing.type !== type || Number(existing.amount) !== amountCent) {
                    return { type: 'CONFLICT', record: existing, accountBefore };
                }
                return { type: 'EXISTING', record: existing, accountBefore };
            }

            const daily = await env.DB.prepare(
                "SELECT COALESCE(SUM(amount), 0) AS total FROM bank_transfers WHERE cst_date=? AND status='SUCCESS'"
            ).bind(cstDate).first();
            if ((Number(daily?.total || 0) + amountCent) > TradeRules.MAX_DAILY_TRANSFER_CENT) {
                return { type: 'LIMIT', accountBefore };
            }

            const createRes = await env.DB.prepare(
                'INSERT INTO bank_transfers (request_id, type, amount, cst_date, status) VALUES (?, ?, ?, ?, ?)'
            ).bind(requestId, type, amountCent, cstDate, 'PROCESSING').run();
            if ((createRes?.meta?.changes || 0) === 0) {
                throw new Error('transfer create failed');
            }

            if (type === 'IN') {
                const inRes = await env.DB.prepare('UPDATE account SET balance = balance + ? WHERE id = 1')
                    .bind(amountCent).run();
                if ((inRes?.meta?.changes || 0) === 0) throw new Error('account update failed');
            } else {
                const outRes = await env.DB.prepare(
                    'UPDATE account SET balance = balance - ? WHERE id = 1 AND (balance - frozen_balance) >= ?'
                ).bind(amountCent, amountCent).run();
                if ((outRes?.meta?.changes || 0) === 0) {
                    await env.DB.prepare(
                        "UPDATE bank_transfers SET status='FAILED', reason='可用余额不足', processed_at=CURRENT_TIMESTAMP WHERE request_id=?"
                    ).bind(requestId).run();
                    const failed = await env.DB.prepare('SELECT * FROM bank_transfers WHERE request_id=?').bind(requestId).first();
                    const accountAfterFailed = await env.DB.prepare('SELECT balance, frozen_balance FROM account WHERE id=1').first();
                    return { type: 'INSUFFICIENT', record: failed, accountBefore, accountAfter: accountAfterFailed };
                }
            }

            const doneRes = await env.DB.prepare(
                "UPDATE bank_transfers SET status='SUCCESS', processed_at=CURRENT_TIMESTAMP WHERE request_id=?"
            ).bind(requestId).run();
            if ((doneRes?.meta?.changes || 0) === 0) throw new Error('transfer finalize failed');

            const done = await env.DB.prepare('SELECT * FROM bank_transfers WHERE request_id=?').bind(requestId).first();
            const accountAfter = await env.DB.prepare('SELECT balance, frozen_balance FROM account WHERE id=1').first();
            return { type: 'SUCCESS', record: done, accountBefore, accountAfter };
        });

        if (result.type === 'EXISTING') {
            await logFinancialAudit(env, {
                event_type: 'TRANSFER',
                scope: 'transfer',
                category: 'fund',
                subcategory: type,
                tags: ['transfer', 'idempotent'],
                status: 'SUCCESS',
                request_id: requestId,
                amount: amountCent,
                message: 'transfer idempotent replay'
            });
            return jsonResponse(buildTransferResponse(result.record));
        }

        if (result.type === 'CONFLICT') {
            await logFinancialAudit(env, {
                event_type: 'TRANSFER',
                scope: 'transfer',
                category: 'fund',
                subcategory: type,
                tags: ['transfer', 'conflict'],
                status: 'FAILED',
                request_id: requestId,
                amount: amountCent,
                message: 'request_id conflict with historical transfer'
            });
            return await auditErrorResponse(env, request, 'request_id 与历史记录不一致', 409, 4108, {
                request_id: requestId,
                type,
                amount_cent: amountCent,
                existing_type: result.record?.type,
                existing_amount: result.record?.amount
            }, 'transfer');
        }

        if (result.type === 'LIMIT') {
            await logFinancialAudit(env, {
                event_type: 'TRANSFER',
                scope: 'transfer',
                category: 'fund',
                subcategory: type,
                tags: ['transfer', 'daily_limit'],
                status: 'FAILED',
                request_id: requestId,
                amount: amountCent,
                message: 'daily transfer limit reached'
            });
            return await auditErrorResponse(
                env,
                request,
                `当日累计转账超过限制（${Money.toYuan(TradeRules.MAX_DAILY_TRANSFER_CENT)} 元）`,
                400,
                4106,
                { amount_cent: amountCent },
                'transfer'
            );
        }

        if (result.type === 'INSUFFICIENT') {
            await logFinancialAudit(env, {
                event_type: 'TRANSFER',
                scope: 'transfer',
                category: 'fund',
                subcategory: type,
                tags: ['transfer', 'insufficient'],
                status: 'FAILED',
                request_id: requestId,
                amount: amountCent,
                balance_before: Number(result.accountBefore?.balance || 0),
                balance_after: Number(result.accountAfter?.balance || 0),
                freeze_before: Number(result.accountBefore?.frozen_balance || 0),
                freeze_after: Number(result.accountAfter?.frozen_balance || 0),
                message: 'insufficient available balance for transfer out'
            });
            return await auditErrorResponse(env, request, '可用余额不足', 400, 4001, { amount_cent: amountCent }, 'transfer');
        }

        await logFinancialAudit(env, {
            event_type: 'TRANSFER',
            scope: 'transfer',
            category: 'fund',
            subcategory: type,
            tags: ['transfer', type === 'IN' ? 'deposit' : 'withdraw'],
            status: 'SUCCESS',
            request_id: requestId,
            amount: amountCent,
            balance_before: Number(result.accountBefore?.balance || 0),
            balance_after: Number(result.accountAfter?.balance || 0),
            freeze_before: Number(result.accountBefore?.frozen_balance || 0),
            freeze_after: Number(result.accountAfter?.frozen_balance || 0),
            message: 'transfer success'
        });
        return jsonResponse(buildTransferResponse(result.record));
    } catch (e) {
        await logFinancialAudit(env, {
            event_type: 'TRANSFER',
            scope: 'transfer',
            category: 'fund',
            subcategory: type,
            tags: ['transfer', 'exception'],
            status: 'FAILED',
            request_id: requestId,
            amount: amountCent,
            message: 'transfer internal error',
            error_stack: e?.stack || ''
        });
        await logError(env, e, { request_id: requestId, type, amount_cent: amountCent }, 'transfer');
        await env.DB.prepare(
            "UPDATE bank_transfers SET status='FAILED', reason=?, processed_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='PROCESSING'"
        ).bind(String(e?.message || 'transfer failed').slice(0, 120), requestId).run();
        return errorResponse('转账失败，请稍后重试', 500, 5100);
    }
};

const queryTradeReports = async (env, options = {}) => {
    const periodType = sanitizePeriodType(options.period_type);
    const page = clampInt(options.page, 1, 1000000);
    const pageSize = clampInt(options.page_size, 20, 100);
    const offset = (page - 1) * pageSize;
    const where = periodType ? 'WHERE period_type=?' : '';
    const bind = periodType ? [periodType] : [];

    const countStmt = env.DB.prepare(`SELECT COUNT(1) AS total FROM trade_reports ${where}`);
    const rowsStmt = env.DB.prepare(`
        SELECT id, period_type, period_key, title, summary, experience, created_by, source,
               created_at, updated_at, created_at_cst
        FROM trade_reports
        ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `);

    const [countRow, rows] = await Promise.all([
        bind.length > 0 ? countStmt.bind(...bind).first() : countStmt.first(),
        bind.length > 0 ? rowsStmt.bind(...bind, pageSize, offset).all() : rowsStmt.bind(pageSize, offset).all()
    ]);
    const total = Number(countRow?.total || 0);
    return {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        items: (rows?.results || []).map((x) => ({
            id: Number(x.id || 0),
            period_type: String(x.period_type || ''),
            period_key: String(x.period_key || ''),
            title: String(x.title || ''),
            summary: String(x.summary || ''),
            experience: String(x.experience || ''),
            created_by: String(x.created_by || ''),
            source: String(x.source || ''),
            created_at_cst: String(x.created_at_cst || ''),
            updated_at: String(x.updated_at || '')
        }))
    };
};

const saveTradeReport = async (env, body = {}, actor = 'manager') => {
    const id = Number(body?.id || 0);
    const periodType = sanitizePeriodType(body?.period_type);
    if (!periodType) throw new Error('period_type 仅支持 DAILY/WEEKLY/MONTHLY');

    const periodKey = buildPeriodKey(periodType, body?.period_key);
    const title = sanitizeText(body?.title || '', 120);
    const summary = sanitizeText(body?.summary || '', 12000);
    const experience = sanitizeText(body?.experience || '', 4000);
    const source = sanitizeText(body?.source || 'manual', 24) || 'manual';

    if (!summary && !experience) {
        throw new Error('summary 与 experience 不能同时为空');
    }

    if (id > 0) {
        const upd = await env.DB.prepare(`
            UPDATE trade_reports
            SET period_type=?, period_key=?, title=?, summary=?, experience=?, created_by=?, source=?,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        `).bind(periodType, periodKey, title, summary, experience, actor, source, id).run();
        if (Number(upd?.meta?.changes || 0) <= 0) throw new Error('report not found');
        return id;
    }

    const ins = await env.DB.prepare(`
        INSERT INTO trade_reports (period_type, period_key, title, summary, experience, created_by, source, created_at_cst)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
    `).bind(periodType, periodKey, title, summary, experience, actor, source).run();
    return Number(ins?.meta?.last_row_id || 0);
};

const queryTradeExperiences = async (env, options = {}) => {
    const page = clampInt(options.page, 1, 1000000);
    const pageSize = clampInt(options.page_size, 30, 200);
    const offset = (page - 1) * pageSize;
    const keyword = sanitizeText(options.keyword || '', 64);
    const where = keyword ? 'WHERE content LIKE ?' : '';
    const bind = keyword ? [`%${keyword}%`] : [];

    const countStmt = env.DB.prepare(`SELECT COUNT(1) AS total FROM trade_experiences ${where}`);
    const rowsStmt = env.DB.prepare(`
        SELECT id, content, weight, source, created_at, updated_at, created_at_cst
        FROM trade_experiences
        ${where}
        ORDER BY weight DESC, id DESC
        LIMIT ? OFFSET ?
    `);

    const [countRow, rows] = await Promise.all([
        bind.length > 0 ? countStmt.bind(...bind).first() : countStmt.first(),
        bind.length > 0 ? rowsStmt.bind(...bind, pageSize, offset).all() : rowsStmt.bind(pageSize, offset).all()
    ]);
    const total = Number(countRow?.total || 0);
    return {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        items: (rows?.results || []).map((x) => ({
            id: Number(x.id || 0),
            content: String(x.content || ''),
            weight: Number(x.weight || 0),
            source: String(x.source || ''),
            created_at_cst: String(x.created_at_cst || ''),
            updated_at: String(x.updated_at || '')
        }))
    };
};

const saveTradeExperience = async (env, body = {}, actor = 'manager') => {
    const id = Number(body?.id || 0);
    const remove = body?.delete === true;
    if (id > 0 && remove) {
        await env.DB.prepare('DELETE FROM trade_experiences WHERE id=?').bind(id).run();
        return { id, deleted: true };
    }

    const content = sanitizeText(body?.content || '', 600);
    if (!content) throw new Error('content 不能为空');
    const weight = clampInt(body?.weight ?? 50, 0, 100);
    const source = sanitizeText(body?.source || actor, 24) || actor;

    if (id > 0) {
        const upd = await env.DB.prepare(`
            UPDATE trade_experiences
            SET content=?, weight=?, source=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        `).bind(content, weight, source, id).run();
        if (Number(upd?.meta?.changes || 0) <= 0) throw new Error('experience not found');
        return { id, deleted: false };
    }

    const ins = await env.DB.prepare(`
        INSERT INTO trade_experiences (content, weight, source, created_at_cst)
        VALUES (?, ?, ?, datetime('now', '+8 hours'))
    `).bind(content, weight, source).run();
    return { id: Number(ins?.meta?.last_row_id || 0), deleted: false };
};

const updateOrderRemark = async (env, body = {}) => {
    const orderId = Number(body?.order_id || 0);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        throw new Error('order_id 非法');
    }
    const remark = sanitizeText(body?.remark || body?.note || body?.memo, 1200);
    const strategyTag = normalizeOrderStrategyTag(body?.strategy_tag || body?.strategy || '');

    const upd = await env.DB.prepare(`
        UPDATE orders
        SET remark=?, strategy_tag=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
    `).bind(remark, strategyTag, orderId).run();
    if (Number(upd?.meta?.changes || 0) <= 0) throw new Error('order not found');

    const row = await env.DB.prepare(`
        SELECT id, symbol, side, status, price, qty, filled_qty, remark, strategy_tag, created_at
        FROM orders
        WHERE id=?
        LIMIT 1
    `).bind(orderId).first();

    return {
        id: Number(row?.id || 0),
        symbol: String(row?.symbol || ''),
        side: String(row?.side || ''),
        status: String(row?.status || ''),
        price: Money.toYuan(row?.price || 0),
        qty: Number(row?.qty || 0),
        filled_qty: Number(row?.filled_qty || 0),
        remark: String(row?.remark || ''),
        strategy_tag: String(row?.strategy_tag || ''),
        created_at: toCstDateTime(row?.created_at || '')
    };
};

const getDbChanges = (result) => Number(result?.meta?.changes || 0);

const handleSystemInitialize = async (env, body = {}) => {
    const confirm = asTrimmed(body?.confirm).toUpperCase();
    if (confirm !== RESET_CONFIRM_TEXT && confirm !== SYNC_CONFIRM_TEXT) {
        return errorResponse(`危险操作，请传入 confirm=${RESET_CONFIRM_TEXT} 或 confirm=${SYNC_CONFIRM_TEXT}`, 400, 4601);
    }

    try {
        if (confirm === SYNC_CONFIRM_TEXT) {
            const schemaSync = await ensureRuntimeSchema(env);
            return await withTransaction(env, async () => {
                const account = await env.DB.prepare('SELECT id, balance, frozen_balance, initial_capital FROM account WHERE id=1').first();
                let initialCapital = Math.max(
                    0,
                    Number(account?.initial_capital || account?.balance || DEFAULT_INITIAL_CAPITAL_CENT)
                );
                if (!account) {
                    await env.DB.prepare(
                        'INSERT INTO account (id, balance, frozen_balance, initial_capital) VALUES (1, ?, 0, ?)'
                    ).bind(initialCapital, initialCapital).run();
                } else {
                    initialCapital = Math.max(initialCapital, 0);
                    await env.DB.prepare(
                        'UPDATE account SET initial_capital=?, updated_at=CURRENT_TIMESTAMP WHERE id=1'
                    ).bind(initialCapital).run();
                }

                const snapCountRow = await env.DB.prepare('SELECT COUNT(1) AS total FROM snapshots').first();
                const snapshotCount = Number(snapCountRow?.total || 0);
                let seededSnapshotDate = '';
                if (snapshotCount <= 0) {
                    const cstNow = Time.getCST();
                    const yesterday = new Date(cstNow.getTime() - 24 * 60 * 60 * 1000);
                    seededSnapshotDate = Time.formatCSTDate(yesterday);
                    await env.DB.prepare(
                        'INSERT INTO snapshots (date, total_assets, day_pnl, total_return_rate, max_drawdown) VALUES (?, ?, 0, 0, 0)'
                    ).bind(seededSnapshotDate, initialCapital).run();
                }

                return jsonResponse({
                    ok: true,
                    message: '结构兼容初始化完成（无清库）',
                    confirm: SYNC_CONFIRM_TEXT,
                    account: {
                        balance: Money.toYuan(initialCapital),
                        initial_capital: Money.toYuan(initialCapital)
                    },
                    schema_sync: schemaSync || { added_columns: [], cst_backfilled_tables: [] },
                    seeded_snapshot_date: seededSnapshotDate || null
                });
            });
        }

        return await withTransaction(env, async () => {
            const account = await env.DB.prepare('SELECT id, balance, frozen_balance, initial_capital FROM account WHERE id=1').first();
            const initialCapital = Math.max(
                0,
                Number(account?.initial_capital || account?.balance || DEFAULT_INITIAL_CAPITAL_CENT)
            );

            if (account) {
                await env.DB.prepare(
                    'UPDATE account SET balance=?, frozen_balance=0, initial_capital=?, updated_at=CURRENT_TIMESTAMP WHERE id=1'
                ).bind(initialCapital, initialCapital).run();
            } else {
                await env.DB.prepare(
                    'INSERT INTO account (id, balance, frozen_balance, initial_capital) VALUES (1, ?, 0, ?)'
                ).bind(initialCapital, initialCapital).run();
            }

            const purge = async (table) => {
                const result = await env.DB.prepare(`DELETE FROM ${table}`).run();
                return getDbChanges(result);
            };

            const summary = {
                holdings: await purge('holdings'),
                orders: await purge('orders'),
                trades: await purge('trades'),
                comments: await purge('comments'),
                transfers: await purge('bank_transfers'),
                ai_committee_runs: await purge('ai_committee_runs'),
                ai_committee_tasks: await purge('ai_committee_tasks'),
                ai_pending_actions: await purge('ai_pending_actions'),
                login_attempts: await purge('login_attempts'),
                audit_technical: await purge('audit_technical'),
                audit_financial: await purge('audit_financial'),
                trade_reports: await purge('trade_reports'),
                trade_experiences: await purge('trade_experiences')
            };

            await env.DB.prepare('DELETE FROM snapshots').run();
            const cstNow = Time.getCST();
            const yesterday = new Date(cstNow.getTime() - 24 * 60 * 60 * 1000);
            const resetSnapshotDate = Time.formatCSTDate(yesterday);
            await env.DB.prepare(
                'INSERT INTO snapshots (date, total_assets, day_pnl, total_return_rate, max_drawdown) VALUES (?, ?, 0, 0, 0)'
            ).bind(resetSnapshotDate, initialCapital).run();

            return jsonResponse({
                ok: true,
                message: '系统已初始化',
                confirm: RESET_CONFIRM_TEXT,
                account: {
                    balance: Money.toYuan(initialCapital),
                    frozen: 0,
                    initial_capital: Money.toYuan(initialCapital)
                },
                reset_snapshot_date: resetSnapshotDate,
                cleared: summary
            });
        });
    } catch (e) {
        console.error('system initialize failed', e);
        return errorResponse('初始化失败，请稍后重试', 500, 5601);
    }
};

const auditErrorResponse = async (env, request, msg, status = 400, code = 4000, meta = {}, scope = 'http') => {
    const url = request ? new URL(request.url) : null;
    const ip = request ? getClientIp(request) : 'unknown';
    await logBizError(env, {
        status,
        message: msg,
        scope,
        category: 'business',
        subcategory: scope,
        meta: {
            code,
            path: url?.pathname || '',
            method: request?.method || '',
            ip,
            ...meta
        }
    });
    return errorResponse(msg, status, code);
};

const normalizeAuditType = (value) => {
    const t = String(value || 'all').toLowerCase();
    if (t === 'technical' || t === 'tech') return 'technical';
    if (t === 'financial' || t === 'finance') return 'financial';
    return 'all';
};

const buildAuditFilters = (params, table = 'technical') => {
    const clauses = [];
    const bind = [];

    const scope = asTrimmed(params.get('scope'));
    const status = asTrimmed(params.get('status'));
    const category = asTrimmed(params.get('category'));
    const subcategory = asTrimmed(params.get('subcategory'));
    const symbol = asTrimmed(params.get('symbol'));
    const requestId = asTrimmed(params.get('request_id'));
    const keyword = asTrimmed(params.get('keyword'));
    const tag = asTrimmed(params.get('tag'));
    const orderIdRaw = asTrimmed(params.get('order_id'));
    const orderId = Number(orderIdRaw);
    const timeFrom = asTrimmed(params.get('time_from'));
    const timeTo = asTrimmed(params.get('time_to'));
    const exact = params.get('exact') === '1';

    if (scope) {
        clauses.push('LOWER(scope) = LOWER(?)');
        bind.push(scope);
    }
    if (status) {
        clauses.push('LOWER(status) = LOWER(?)');
        bind.push(status);
    }
    if (category) {
        clauses.push('LOWER(category) = LOWER(?)');
        bind.push(category);
    }
    if (subcategory) {
        clauses.push('LOWER(subcategory) = LOWER(?)');
        bind.push(subcategory);
    }
    if (symbol) {
        clauses.push('LOWER(symbol) = LOWER(?)');
        bind.push(symbol);
    }
    if (requestId) {
        clauses.push('request_id = ?');
        bind.push(requestId);
    }
    if (Number.isInteger(orderId) && orderId > 0) {
        clauses.push('order_id = ?');
        bind.push(orderId);
    }
    if (timeFrom) {
        clauses.push('created_at_cst >= ?');
        bind.push(timeFrom);
    }
    if (timeTo) {
        clauses.push('created_at_cst <= ?');
        bind.push(timeTo);
    }
    if (tag) {
        clauses.push("LOWER(',' || tags || ',') LIKE LOWER(?)");
        bind.push(`%,${tag},%`);
    }

    if (table === 'financial') {
        const amountMinRaw = asTrimmed(params.get('amount_min'));
        const amountMaxRaw = asTrimmed(params.get('amount_max'));
        if (amountMinRaw !== '') {
            const amountMin = Number(amountMinRaw);
            if (Number.isFinite(amountMin)) {
                clauses.push('COALESCE(amount, 0) >= ?');
                bind.push(Math.trunc(amountMin));
            }
        }
        if (amountMaxRaw !== '') {
            const amountMax = Number(amountMaxRaw);
            if (Number.isFinite(amountMax)) {
                clauses.push('COALESCE(amount, 0) <= ?');
                bind.push(Math.trunc(amountMax));
            }
        }
    }

    if (keyword) {
        if (exact) {
            if (table === 'financial') {
                clauses.push(
                    '(LOWER(scope) = LOWER(?) OR LOWER(category) = LOWER(?) OR LOWER(subcategory) = LOWER(?) OR LOWER(side) = LOWER(?) OR LOWER(symbol) = LOWER(?) OR request_id = ? OR CAST(order_id AS TEXT) = ? OR LOWER(event_type) = LOWER(?) OR LOWER(message) = LOWER(?) OR LOWER(tags) = LOWER(?))'
                );
                bind.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
            } else {
                clauses.push(
                    '(LOWER(scope) = LOWER(?) OR LOWER(category) = LOWER(?) OR LOWER(subcategory) = LOWER(?) OR LOWER(symbol) = LOWER(?) OR request_id = ? OR CAST(order_id AS TEXT) = ? OR LOWER(level) = LOWER(?) OR LOWER(message) = LOWER(?) OR LOWER(tags) = LOWER(?))'
                );
                bind.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword, keyword);
            }
        } else {
            const like = `%${keyword}%`;
            if (table === 'financial') {
                clauses.push(
                    '(LOWER(scope) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?) OR LOWER(subcategory) LIKE LOWER(?) OR LOWER(message) LIKE LOWER(?) OR LOWER(symbol) LIKE LOWER(?) OR request_id LIKE ? OR CAST(order_id AS TEXT) LIKE ? OR LOWER(event_type) LIKE LOWER(?) OR LOWER(side) LIKE LOWER(?) OR LOWER(tags) LIKE LOWER(?))'
                );
                bind.push(like, like, like, like, like, like, like, like, like, like);
            } else {
                clauses.push(
                    '(LOWER(scope) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?) OR LOWER(subcategory) LIKE LOWER(?) OR LOWER(message) LIKE LOWER(?) OR LOWER(stack) LIKE LOWER(?) OR LOWER(symbol) LIKE LOWER(?) OR request_id LIKE ? OR CAST(order_id AS TEXT) LIKE ? OR LOWER(level) LIKE LOWER(?) OR LOWER(tags) LIKE LOWER(?))'
                );
                bind.push(like, like, like, like, like, like, like, like, like, like);
            }
        }
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return { whereSql, bind };
};

const queryAuditTable = async (env, table, filters, page, pageSize) => {
    const offset = (page - 1) * pageSize;
    const { whereSql, bind } = buildAuditFilters(filters, table === 'audit_financial' ? 'financial' : 'technical');

    const countSql = `SELECT COUNT(1) AS total FROM ${table} ${whereSql}`;
    const countRow = await env.DB.prepare(countSql).bind(...bind).first();
    const total = Number(countRow?.total || 0);

    const dataSql = `SELECT * FROM ${table} ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const { results } = await env.DB.prepare(dataSql).bind(...bind, pageSize, offset).all();

    return {
        items: (results || []).map((row) => ({
            ...row,
            meta: parseJsonMaybe(row.meta),
            source: table === 'audit_financial' ? 'financial' : 'technical'
        })),
        total
    };
};

const handleAuditQuery = async (env, url) => {
    const auditType = normalizeAuditType(url.searchParams.get('type'));
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('page_size') || 20) || 20));

    if (auditType === 'technical') {
        const result = await queryAuditTable(env, 'audit_technical', url.searchParams, page, pageSize);
        return jsonResponse({
            type: 'technical',
            page,
            page_size: pageSize,
            total: result.total,
            total_pages: Math.max(1, Math.ceil(result.total / pageSize)),
            items: result.items
        });
    }

    if (auditType === 'financial') {
        const result = await queryAuditTable(env, 'audit_financial', url.searchParams, page, pageSize);
        return jsonResponse({
            type: 'financial',
            page,
            page_size: pageSize,
            total: result.total,
            total_pages: Math.max(1, Math.ceil(result.total / pageSize)),
            items: result.items
        });
    }

    const tech = await queryAuditTable(env, 'audit_technical', url.searchParams, 1, pageSize);
    const fin = await queryAuditTable(env, 'audit_financial', url.searchParams, 1, pageSize);
    const merged = [...tech.items, ...fin.items]
        .sort((a, b) => String(b.created_at_cst || '').localeCompare(String(a.created_at_cst || '')))
        .slice((page - 1) * pageSize, page * pageSize);
    const total = tech.total + fin.total;

    return jsonResponse({
        type: 'all',
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        items: merged
    });
};

const toInt = (v) => Number(v || 0);

const handleIntegrityQuery = async (env) => {
    const [
        account,
        pendingFreezeRow,
        invalidHoldingsRow,
        invalidOrdersRow,
        orphanTradesRow,
        staleMatchingRow,
        failedTechRow,
        failedFinRow,
        failTechScopes,
        failFinScopes
    ] = await Promise.all([
        env.DB.prepare('SELECT balance, frozen_balance, initial_capital FROM account WHERE id=1').first(),
        env.DB.prepare("SELECT COALESCE(SUM(freeze_amount), 0) AS total FROM orders WHERE side='BUY' AND status IN ('PENDING','MATCHING')").first(),
        env.DB.prepare(
            'SELECT COUNT(1) AS total FROM holdings WHERE quantity < 0 OR available_qty < 0 OR available_qty > quantity OR avg_cost < 0 OR total_cost < 0'
        ).first(),
        env.DB.prepare(
            "SELECT COUNT(1) AS total FROM orders WHERE qty <= 0 OR filled_qty < 0 OR filled_qty > qty OR price <= 0 OR freeze_amount < 0 OR status NOT IN ('PENDING','MATCHING','FILLED','PARTIAL','CANCELLED','EXPIRED','ERROR')"
        ).first(),
        env.DB.prepare(
            'SELECT COUNT(1) AS total FROM trades t LEFT JOIN orders o ON o.id=t.order_id WHERE t.order_id IS NOT NULL AND o.id IS NULL'
        ).first(),
        env.DB.prepare("SELECT COUNT(1) AS total FROM orders WHERE status='MATCHING' AND updated_at <= datetime('now', '-2 minutes')").first(),
        env.DB.prepare("SELECT COUNT(1) AS total FROM audit_technical WHERE status='FAILED'").first(),
        env.DB.prepare("SELECT COUNT(1) AS total FROM audit_financial WHERE status='FAILED'").first(),
        env.DB.prepare("SELECT scope, COUNT(1) AS total FROM audit_technical WHERE status='FAILED' GROUP BY scope ORDER BY total DESC LIMIT 5").all(),
        env.DB.prepare("SELECT scope, COUNT(1) AS total FROM audit_financial WHERE status='FAILED' GROUP BY scope ORDER BY total DESC LIMIT 5").all()
    ]);

    const balance = toInt(account?.balance);
    const frozen = toInt(account?.frozen_balance);
    const pendingFreeze = toInt(pendingFreezeRow?.total);
    const freezeDiff = frozen - pendingFreeze;
    const invalidHoldings = toInt(invalidHoldingsRow?.total);
    const invalidOrders = toInt(invalidOrdersRow?.total);
    const orphanTrades = toInt(orphanTradesRow?.total);
    const staleMatching = toInt(staleMatchingRow?.total);
    const failedTech = toInt(failedTechRow?.total);
    const failedFin = toInt(failedFinRow?.total);

    const findings = [];
    if (balance < 0) findings.push('account.balance is negative');
    if (frozen < 0) findings.push('account.frozen_balance is negative');
    if (freezeDiff !== 0) findings.push(`frozen balance mismatch (${frozen} vs pending freeze ${pendingFreeze})`);
    if (invalidHoldings > 0) findings.push(`invalid holdings rows: ${invalidHoldings}`);
    if (invalidOrders > 0) findings.push(`invalid orders rows: ${invalidOrders}`);
    if (orphanTrades > 0) findings.push(`orphan trades: ${orphanTrades}`);
    if (staleMatching > 0) findings.push(`stale matching orders: ${staleMatching}`);

    const healthy = findings.length === 0;
    const severity = !healthy ? 'HIGH' : ((failedTech + failedFin) > 0 ? 'MEDIUM' : 'LOW');

    return jsonResponse({
        healthy,
        severity,
        findings,
        checks: {
            account: {
                balance,
                frozen_balance: frozen,
                initial_capital: toInt(account?.initial_capital),
                pending_buy_freeze: pendingFreeze,
                freeze_diff: freezeDiff
            },
            holdings: { invalid_rows: invalidHoldings },
            orders: { invalid_rows: invalidOrders, stale_matching: staleMatching },
            trades: { orphan_rows: orphanTrades }
        },
        audit: {
            failed_technical_total: failedTech,
            failed_financial_total: failedFin,
            top_technical_scopes: (failTechScopes?.results || []).map((x) => ({ scope: x.scope || 'unknown', total: toInt(x.total) })),
            top_financial_scopes: (failFinScopes?.results || []).map((x) => ({ scope: x.scope || 'unknown', total: toInt(x.total) }))
        }
    });
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;

        if (method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
                }
            });
        }

        try {
            await ensureRuntimeSchema(env);

            if (url.pathname === '/api/public/quote') {
                if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'public.quote');
                const symbol = asTrimmed(url.searchParams.get('symbol'));
                if (!symbol) return await auditErrorResponse(env, request, 'symbol 不能为空', 400, 4007, {}, 'public.quote');

                const quote = await fetchStockPrice(symbol);
                if (!quote) return await auditErrorResponse(env, request, '无法获取行情（可能停牌或退市）', 400, 4005, { symbol }, 'public.quote');

                const lastPrice = Number(quote.price || 0);
                const prevClose = Number(quote.prevClose || 0);
                const lastPriceCent = Money.toCent(lastPrice);
                const prevCloseCent = Money.toCent(prevClose > 0 ? prevClose : lastPrice);
                const assist = getPriceAssist(quote.symbol, lastPriceCent, prevCloseCent, {
                    apply_cage: Time.isContinuousAuction()
                });
                const pct = prevClose > 0 ? Number((((lastPrice - prevClose) / prevClose) * 100).toFixed(2)) : 0;
                return jsonResponse({
                    symbol: quote.symbol,
                    name: quote.name,
                    price: Number(lastPrice.toFixed(2)),
                    prev_close: prevClose > 0 ? Number(prevClose.toFixed(2)) : null,
                    change_pct: pct,
                    source: quote.source || 'unknown',
                    price_guard: assist.limit ? {
                        board: assist.board,
                        reference_price: Money.toYuan(assist.reference_cent),
                        limit_up: Money.toYuan(assist.limit.high),
                        limit_down: Money.toYuan(assist.limit.low),
                        limit_pct: assist.limit.pct,
                        cage_enabled: !!assist.cage?.enabled,
                        cage_applicable: !!assist.cage?.applicable,
                        cage_mode: assist.cage?.mode || 'NONE',
                        cage_reason: assist.cage?.reason || '',
                        buy_up: Money.toYuan(assist.cage?.buy_upper || assist.limit.high),
                        sell_down: Money.toYuan(assist.cage?.sell_lower || assist.limit.low),
                        cage_up: Money.toYuan(assist.cage?.high || assist.limit.high),
                        cage_down: Money.toYuan(assist.cage?.low || assist.limit.low),
                        cage_pct: Number(assist.cage?.pct || 0),
                        suggest_buy: Money.toYuan(assist.suggest?.buy || lastPriceCent),
                        suggest_sell: Money.toYuan(assist.suggest?.sell || lastPriceCent),
                        suggest_mid: Money.toYuan(assist.suggest?.mid || lastPriceCent),
                        tick: 0.01
                    } : null
                });
            }

            if (url.pathname === '/api/public/overview') {
                if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'public.overview');

                const account = await env.DB.prepare('SELECT * FROM account WHERE id=1').first();
                const { results: holdings } = await env.DB.prepare('SELECT * FROM holdings WHERE quantity > 0').all();
                const { results: logs } = await env.DB.prepare(
                    "SELECT *, datetime(trade_time, '+8 hours') AS trade_time_cst FROM trades ORDER BY id DESC LIMIT 20"
                ).all();
                const { results: snaps } = await env.DB.prepare('SELECT * FROM snapshots ORDER BY date ASC').all();
                let aiPublic = {
                    enabled: false,
                    latest: null,
                    discussion_digest: null,
                    news_references: []
                };

                try {
                    const [aiEnabledRow, aiRunRow, aiLastMetaRow] = await Promise.all([
                        env.DB.prepare("SELECT value FROM meta WHERE key='ai.enabled'").first(),
                        env.DB.prepare(`
                            SELECT run_id, trigger, status, phase, actions_total, executed_total, detail, created_at_cst
                            FROM ai_committee_runs
                            ORDER BY id DESC
                            LIMIT 1
                        `).first(),
                        env.DB.prepare("SELECT value FROM meta WHERE key='ai.last_run'").first()
                    ]);

                    const detail = parseJsonMaybe(aiRunRow?.detail) || {};
                    const lastMeta = parseJsonMaybe(aiLastMetaRow?.value) || {};
                    const summary = detail?.summary || lastMeta || {};
                    const discussionDigest = detail?.discussion_digest || summary?.discussion_digest || null;
                    const newsReferences = Array.isArray(detail?.news_references)
                        ? detail.news_references
                        : (Array.isArray(summary?.news_references) ? summary.news_references : []);
                    const atomicPrecheck = (summary?.atomic_precheck && typeof summary.atomic_precheck === 'object')
                        ? summary.atomic_precheck
                        : null;
                    const blockedReasons = Array.isArray(atomicPrecheck?.blocked_reasons)
                        ? atomicPrecheck.blocked_reasons.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
                        : [];
                    const nonBlockingReasons = Array.isArray(atomicPrecheck?.non_blocking_reasons)
                        ? atomicPrecheck.non_blocking_reasons.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
                        : [];
                    const latest = aiRunRow || summary?.run_id
                        ? {
                            run_id: String(aiRunRow?.run_id || summary?.run_id || ''),
                            trigger: String(aiRunRow?.trigger || summary?.trigger || ''),
                            status: String(aiRunRow?.status || (summary?.skipped ? 'SKIPPED' : 'SUCCESS') || ''),
                            phase: String(aiRunRow?.phase || ''),
                            created_at_cst: String(aiRunRow?.created_at_cst || summary?.at || ''),
                            manager_winner: String(summary?.manager_winner || discussionDigest?.manager?.winner || ''),
                            actions_total: Number(summary?.actions_total || aiRunRow?.actions_total || 0),
                            executed_total: Number(summary?.execution?.succeeded || aiRunRow?.executed_total || 0),
                            pending_actions: Number(summary?.pending_actions || 0),
                            execution_mode: String(summary?.execution_mode || ''),
                            manual_request: summary?.manual_request === true,
                            gemini_api_throttled: summary?.gemini_api_throttled === true,
                            skipped: summary?.skipped === true || String(aiRunRow?.status || '').toUpperCase() === 'SKIPPED',
                            reason: String(summary?.reason || ''),
                            blocked_count: Number(atomicPrecheck?.blocked_count || blockedReasons.length || 0),
                            blocked_reasons: blockedReasons,
                            non_blocking_count: Number(atomicPrecheck?.non_blocking_count || nonBlockingReasons.length || 0),
                            non_blocking_reasons: nonBlockingReasons
                        }
                        : null;

                    aiPublic = {
                        enabled: parseBoolMaybe(aiEnabledRow?.value),
                        latest,
                        discussion_digest: discussionDigest,
                        news_references: (newsReferences || []).slice(0, 6)
                    };
                } catch {
                    // keep public overview available even when AI tables are unavailable.
                }

                let marketCap = 0;
                let totalCost = 0;
                const holdingList = [];

                await Promise.all((holdings || []).map(async (h) => {
                    const m = await fetchStockPrice(h.symbol);
                    const curPriceCent = m ? Money.toCent(m.price) : Number(h.avg_cost || 0);
                    const valCent = curPriceCent * Number(h.quantity || 0);
                    marketCap += valCent;
                    totalCost += Number(h.total_cost || 0);

                    holdingList.push({
                        name: h.name,
                        code: h.symbol,
                        quantity: h.quantity,
                        cost: Money.toYuan(h.avg_cost),
                        price: Money.toYuan(curPriceCent),
                        pnl_val: Money.toYuan(valCent - Number(h.total_cost || 0)),
                        pnl_rate: Number(h.avg_cost || 0) > 0 ? parseFloat((((curPriceCent - Number(h.avg_cost || 0)) / Number(h.avg_cost || 0)) * 100).toFixed(2)) : 0,
                        val_cent: valCent
                    });
                }));

                const totalAssetsCent = Number(account.balance || 0) + marketCap;
                const totalAssetsYuan = Money.toYuan(totalAssetsCent);

                holdingList.forEach((h) => {
                    h.position_rate = totalAssetsCent > 0
                        ? parseFloat(((h.val_cent / totalAssetsCent) * 100).toFixed(2))
                        : 0;
                    delete h.val_cent;
                });

                const todayStr = Time.formatCSTDate();
                const lastSnap = (snaps || []).filter((s) => s.date !== todayStr).pop() || { total_assets: account.initial_capital };
                const dayPnlCent = totalAssetsCent - Number(lastSnap.total_assets || 0);
                const historicalAssets = (snaps || [])
                    .filter((s) => s.date !== todayStr)
                    .map((s) => ({ date: s.date, value: Money.toYuan(s.total_assets) }));

                return jsonResponse({
                    assets: {
                        total: totalAssetsYuan,
                        market_cap: Money.toYuan(marketCap),
                        balance: Money.toYuan(Number(account.balance || 0) - Number(account.frozen_balance || 0)),
                        frozen: Money.toYuan(account.frozen_balance),
                        pnl_holding: Money.toYuan(marketCap - totalCost),
                        day_pnl: Money.toYuan(dayPnlCent),
                        day_pct: Number(lastSnap.total_assets || 0) > 0
                            ? parseFloat(((dayPnlCent / Number(lastSnap.total_assets || 0)) * 100).toFixed(2))
                            : 0,
                        return_total_pct: Number(account.initial_capital || 0) > 0
                            ? parseFloat((((totalAssetsCent - Number(account.initial_capital || 0)) / Number(account.initial_capital || 0)) * 100).toFixed(2))
                            : 0,
                        max_drawdown: 0
                    },
                    holdings: holdingList.sort((a, b) => b.position_rate - a.position_rate),
                    logs: (logs || []).map((l) => {
                        const pre = Number(l.pre_pos_ratio || 0).toFixed(2);
                        const post = Number(l.post_pos_ratio || 0).toFixed(2);
                        return {
                            text: `${l.side === 'BUY' ? '买入' : '卖出'} ${l.name || ''} ${l.symbol || ''}`,
                            detail: `单号#${l.order_id || '--'} | 价 ${Money.toYuan(l.price)} | 量 ${l.qty || 0} | 额 ${Money.toYuan(l.amount || 0)} | 手续费 ${Money.toYuan(l.commission || 0)} | 税 ${Money.toYuan(l.tax || 0)} | 仓位 ${pre}%→${post}%`,
                            side: l.side,
                            time: l.trade_time_cst || l.trade_time,
                            order_id: l.order_id,
                            symbol: l.symbol,
                            price: Money.toYuan(l.price),
                            qty: l.qty,
                            amount: Money.toYuan(l.amount || 0),
                            commission: Money.toYuan(l.commission || 0),
                            tax: Money.toYuan(l.tax || 0)
                        };
                    }),
                    charts: {
                        asset: historicalAssets,
                        latest: { date: todayStr, value: totalAssetsYuan }
                    },
                    ai: aiPublic
                });
            }

            if (url.pathname === '/api/public/market-etfs') {
                if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'public.market_etfs');
                const quotes = await loadMarketEtfQuotes();
                return jsonResponse({
                    symbols: [...MARKET_ETF_SYMBOLS],
                    items: quotes
                });
            }

            if (url.pathname === '/api/public/comments') {
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM comments ORDER BY id DESC LIMIT 50').all();
                    return jsonResponse(results);
                }
                if (method === 'POST') {
                    const body = await parseBody(request);
                    if (!body) return await auditErrorResponse(env, request, '请求体非法', 400, 4200, {}, 'public.comments');

                    const nickname = asTrimmed(body.nickname) || 'Guest';
                    const content = asTrimmed(body.content);
                    if (!content) return await auditErrorResponse(env, request, '评论内容不能为空', 400, 4201, { nickname }, 'public.comments');
                    if (nickname.length > 20) return await auditErrorResponse(env, request, '昵称长度不能超过 20', 400, 4202, { nickname }, 'public.comments');
                    if (content.length > 500) return await auditErrorResponse(env, request, '评论长度不能超过 500', 400, 4203, { nickname, length: content.length }, 'public.comments');

                    await env.DB.prepare('INSERT INTO comments (nickname, content) VALUES (?, ?)').bind(nickname, content).run();
                    return jsonResponse({ msg: 'ok' });
                }
                return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'public.comments');
            }

            if (url.pathname === '/api/auth/login') {
                if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'auth.login');

                const ip = getClientIp(request);
                const lock = await getLockState(env, ip);
                if (lock.locked) {
                    const minutes = Math.max(1, Math.ceil(lock.remainMs / 60000));
                    return await auditErrorResponse(env, request, `登录失败次数过多，请 ${minutes} 分钟后重试`, 429, 4291, { ip }, 'auth.login');
                }

                const body = await parseBody(request);
                const password = body?.password;
                if (typeof password !== 'string' || !password) {
                    await recordLoginFailure(env, ip);
                    return await auditErrorResponse(env, request, '用户名或密码错误', 401, 4011, { ip }, 'auth.login');
                }

                if (await verifyPassword(password, env)) {
                    await clearLoginFailures(env, ip);
                    return jsonResponse({ token: await signToken(env) });
                }

                await recordLoginFailure(env, ip);
                return await auditErrorResponse(env, request, '用户名或密码错误', 401, 4011, { ip }, 'auth.login');
            }

            // === Debug endpoints first — bypass admin auth, use X-Debug-Key header ===
            if (url.pathname.startsWith('/api/admin/debug/')) {
                if (url.pathname === '/api/admin/debug/verify') {
                    return await handleDebugVerify(request, env);
                }
                if (url.pathname === '/api/admin/debug/status') {
                    return jsonResponse({ enabled: isDebugEnabled(env) });
                }
                if (url.pathname === '/api/admin/debug/simulate-match') {
                    return await handleDebugSimulateMatch(request, env, ctx);
                }
                if (url.pathname === '/api/admin/debug/cleanup-logs') {
                    return await handleDebugCleanupLogs(request, env);
                }
                return errorResponse('Not Found', 404, 4040);
            }

            if (url.pathname.startsWith('/api/admin/')) {
                if (!await verifyAuth(request, env)) {
                    return await auditErrorResponse(env, request, 'Unauthorized', 401, 4010, {}, 'admin.auth');
                }

                if (url.pathname === '/api/admin/dashboard') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.dashboard');

                    const acc = await env.DB.prepare('SELECT * FROM account WHERE id=1').first();
                    const { results: holds } = await env.DB.prepare('SELECT * FROM holdings').all();

                    let marketCap = 0;
                    for (const h of holds || []) {
                        const m = await fetchStockPrice(h.symbol);
                        const priceCent = m ? Money.toCent(m.price) : Number(h.avg_cost || 0);
                        marketCap += priceCent * Number(h.quantity || 0);
                    }

                    const availableCent = Number(acc.balance || 0) - Number(acc.frozen_balance || 0);
                    return jsonResponse({
                        total: Money.toYuan(Number(acc.balance || 0) + marketCap),
                        market_cap: Money.toYuan(marketCap),
                        available: Money.toYuan(availableCent),
                        frozen: Money.toYuan(acc.frozen_balance),
                        withdrawable: Money.toYuan(availableCent)
                    });
                }

                if (url.pathname === '/api/admin/orders') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.orders');
                    const daysRaw = Number(url.searchParams.get('days') || 7);
                    const days = Math.min(30, Math.max(1, Number.isFinite(daysRaw) ? Math.trunc(daysRaw) : 7));
                    const cstNow = Time.getCST();
                    const since = new Date(cstNow.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
                    const sinceCst = `${Time.formatCSTDate(since)} 00:00:00`;

                    const { results } = await env.DB.prepare(`
                        SELECT *, datetime(created_at, '+8 hours') AS created_at_cst
                        FROM orders
                        WHERE status = 'PENDING'
                           OR datetime(created_at, '+8 hours') >= ?
                        ORDER BY id DESC
                        LIMIT 1000
                    `).bind(sinceCst).all();
                    return jsonResponse((results || []).map((o) => ({
                        ...o,
                        price: Money.toYuan(o.price),
                        remark: String(o.remark || ''),
                        strategy_tag: String(o.strategy_tag || ''),
                        time: String(o.created_at_cst || o.created_at || '').substring(11, 19)
                    })));
                }

                if (url.pathname === '/api/admin/order-note') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.order_note');
                    const body = await parseBody(request);
                    if (!body || typeof body !== 'object') {
                        return await auditErrorResponse(env, request, '请求体非法', 400, 4300, {}, 'admin.order_note');
                    }
                    try {
                        const data = await updateOrderRemark(env, body);
                        return jsonResponse(data);
                    } catch (e) {
                        return await auditErrorResponse(
                            env,
                            request,
                            String(e?.message || 'order note update failed'),
                            400,
                            4305,
                            {},
                            'admin.order_note'
                        );
                    }
                }

                if (url.pathname === '/api/admin/market-etfs') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.market_etfs');
                    const quotes = await loadMarketEtfQuotes();
                    return jsonResponse({
                        symbols: [...MARKET_ETF_SYMBOLS],
                        items: quotes
                    });
                }

                if (url.pathname === '/api/admin/trade-reports') {
                    if (method === 'GET') {
                        const periodType = sanitizePeriodType(url.searchParams.get('period_type'));
                        const page = Number(url.searchParams.get('page') || 1);
                        const pageSize = Number(url.searchParams.get('page_size') || 20);
                        return jsonResponse(await queryTradeReports(env, {
                            period_type: periodType,
                            page,
                            page_size: pageSize
                        }));
                    }
                    if (method === 'POST') {
                        const body = await parseBody(request);
                        if (!body || typeof body !== 'object') {
                            return await auditErrorResponse(env, request, '请求体非法', 400, 4300, {}, 'admin.trade_reports');
                        }
                        try {
                            const id = await saveTradeReport(env, body, 'manager');
                            return jsonResponse({
                                id,
                                saved: true,
                                reports: await queryTradeReports(env, { page: 1, page_size: 20 })
                            });
                        } catch (e) {
                            return await auditErrorResponse(
                                env,
                                request,
                                String(e?.message || 'trade report save failed'),
                                400,
                                4306,
                                {},
                                'admin.trade_reports'
                            );
                        }
                    }
                    return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.trade_reports');
                }

                if (url.pathname === '/api/admin/trade-experiences') {
                    if (method === 'GET') {
                        const keyword = sanitizeText(url.searchParams.get('keyword') || '', 64);
                        const page = Number(url.searchParams.get('page') || 1);
                        const pageSize = Number(url.searchParams.get('page_size') || 30);
                        return jsonResponse(await queryTradeExperiences(env, {
                            keyword,
                            page,
                            page_size: pageSize
                        }));
                    }
                    if (method === 'POST') {
                        const body = await parseBody(request);
                        if (!body || typeof body !== 'object') {
                            return await auditErrorResponse(env, request, '请求体非法', 400, 4300, {}, 'admin.trade_experiences');
                        }
                        try {
                            const result = await saveTradeExperience(env, body, 'manager');
                            return jsonResponse({
                                ...result,
                                items: await queryTradeExperiences(env, { page: 1, page_size: 50 })
                            });
                        } catch (e) {
                            return await auditErrorResponse(
                                env,
                                request,
                                String(e?.message || 'trade experience save failed'),
                                400,
                                4307,
                                {},
                                'admin.trade_experiences'
                            );
                        }
                    }
                    return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.trade_experiences');
                }

                if (url.pathname === '/api/admin/trade') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.trade');
                    const body = await parseBody(request);
                    if (!body) return await auditErrorResponse(env, request, '请求体非法', 400, 4300, {}, 'admin.trade');

                    const res = await placeOrder(env, body);
                    ctx.waitUntil(matchOrders(env, { force: true }));
                    return res;
                }

                if (url.pathname === '/api/admin/match') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.match');
                    const body = await parseBody(request);
                    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 120) : '';
                    const ip = getClientIp(request);
                    try {
                        const result = await matchOrders(env, { force: true });

                        await logBizError(env, {
                            level: 'INFO',
                            status: 200,
                            message: 'manual match triggered',
                            scope: 'trade.match.manual',
                            category: 'operation',
                            subcategory: 'manual_match',
                            meta: { ip, reason, result }
                        });

                        await logFinancialAudit(env, {
                            event_type: 'MATCH_TRIGGER',
                            scope: 'trade.match.manual',
                            category: 'operation',
                            subcategory: 'MANUAL',
                            tags: ['match', 'manual', 'trigger'],
                            status: 'SUCCESS',
                            qty: Number(result?.checked || 0),
                            amount: Number(result?.triggered || 0),
                            message: 'manual match triggered',
                            meta: {
                                ip,
                                reason,
                                checked: Number(result?.checked || 0),
                                triggered: Number(result?.triggered || 0),
                                skipped: !!result?.skipped,
                                forced: true
                            }
                        });

                        return jsonResponse(result);
                    } catch (e) {
                        await logFinancialAudit(env, {
                            event_type: 'MATCH_TRIGGER',
                            scope: 'trade.match.manual',
                            category: 'operation',
                            subcategory: 'MANUAL',
                            tags: ['match', 'manual', 'trigger'],
                            status: 'FAILED',
                            message: 'manual match failed',
                            error_stack: e?.stack || '',
                            meta: { ip, reason, forced: true }
                        });
                        throw e;
                    }
                }

                if (url.pathname === '/api/admin/cancel') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.cancel');
                    const body = await parseBody(request);
                    if (!body) return await auditErrorResponse(env, request, '请求体非法', 400, 4300, {}, 'admin.cancel');
                    return await cancelOrder(env, body.order_id);
                }

                if (url.pathname === '/api/admin/holdings') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.holdings');

                    const { results } = await env.DB.prepare('SELECT * FROM holdings').all();
                    const list = [];
                    for (const h of results || []) {
                        const m = await fetchStockPrice(h.symbol);
                        const curPriceYuan = m ? parseFloat(m.price) : Money.toYuan(h.avg_cost);

                        list.push({
                            symbol: h.symbol,
                            name: h.name,
                            quantity: h.quantity,
                            available_qty: h.available_qty,
                            avg_cost: Money.toYuan(h.avg_cost),
                            current_price: curPriceYuan,
                            total_cost: Money.toYuan(h.total_cost)
                        });
                    }
                    return jsonResponse(list);
                }

                if (url.pathname === '/api/admin/transfer') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.transfer');
                    const body = await parseBody(request);
                    return await handleTransfer(env, body, request);
                }

                if (url.pathname === '/api/admin/init') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.init');
                    const body = await parseBody(request);
                    return await handleSystemInitialize(env, body || {});
                }

                if (url.pathname === '/api/admin/ai/state') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.state');
                    return jsonResponse(await getAiState(env));
                }

                if (url.pathname === '/api/admin/ai/prompts') {
                    if (method === 'GET') {
                        return jsonResponse(await getAiPrompts(env));
                    }

                    if (method === 'POST') {
                        const body = await parseBody(request);
                        if (!body || typeof body !== 'object') {
                            return await auditErrorResponse(env, request, '请求体非法', 400, 4300, {}, 'admin.ai.prompts');
                        }
                        const role = asTrimmed(body.role);
                        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
                        if (!role || !prompt) {
                            return await auditErrorResponse(env, request, 'role 和 prompt 不能为空', 400, 4301, { role }, 'admin.ai.prompts');
                        }
                        try {
                            await setAiPrompt(env, role, prompt, 'admin');
                        } catch (e) {
                            return await auditErrorResponse(
                                env,
                                request,
                                String(e?.message || 'prompt update failed'),
                                400,
                                4302,
                                { role },
                                'admin.ai.prompts'
                            );
                        }
                        return jsonResponse(await getAiPrompts(env));
                    }

                    return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.prompts');
                }

                if (url.pathname === '/api/admin/ai/config') {
                    if (method === 'GET') {
                        return jsonResponse(await getAiState(env));
                    }
                    if (method === 'POST') {
                        const body = await parseBody(request);
                        if (!body || typeof body !== 'object') {
                            return await auditErrorResponse(env, request, '请求体非法', 400, 4300, {}, 'admin.ai.config');
                        }
                        return jsonResponse(await updateAiConfig(env, body));
                    }
                    return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.config');
                }

                if (url.pathname === '/api/admin/ai/runs') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.runs');
                    const runId = asTrimmed(url.searchParams.get('run_id'));
                    const page = Number(url.searchParams.get('page') || 1);
                    const pageSize = Number(url.searchParams.get('page_size') || 20);
                    const includeDetail = url.searchParams.get('include_detail') === '1';
                    return jsonResponse(await getAiRuns(env, {
                        run_id: runId || '',
                        page,
                        page_size: pageSize,
                        include_detail: includeDetail
                    }));
                }

                if (url.pathname === '/api/admin/ai/run') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.run');
                    const body = await parseBody(request) || {};
                    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 64) : 'manual';
                    const executionMode = typeof body.execution_mode === 'string'
                        ? String(body.execution_mode).trim().toUpperCase()
                        : (body.review_only === true ? 'USER_CONFIRM' : 'AUTO_EXECUTE');
                    const payload = {
                        force: body?.force === true,
                        dry_run: body?.dry_run === true,
                        reason: reason || 'run',
                        requested_by: 'admin_api',
                        manual_request: body?.manual_request !== false,
                        execution_mode: executionMode === 'USER_CONFIRM' ? 'USER_CONFIRM' : 'AUTO_EXECUTE'
                    };

                    try {
                        const wantsImmediate = body.immediate === true;
                        if (wantsImmediate) {
                            const queued = await queueAiTask(env, payload);
                            if (ctx?.waitUntil) {
                                ctx.waitUntil((async () => {
                                    try {
                                        await runQueuedTaskById(env, queued.task_id);
                                    } catch (e) {
                                        await logError(env, e, { task_id: queued.task_id, trigger: 'inline' }, 'ai.task.inline');
                                    }
                                })());
                            } else {
                                await runQueuedTaskById(env, queued.task_id);
                            }
                            return jsonResponse({
                                ...queued,
                                immediate: true,
                                executed: false,
                                queued_only: true,
                                execute_via: ctx?.waitUntil ? 'inline' : 'cron',
                                message: ctx?.waitUntil
                                    ? 'task accepted, executing inline in background; poll tasks/runs for status'
                                    : 'task accepted, executing inline; poll tasks/runs for status'
                            });
                        }

                        const queued = await queueAiTask(env, payload);
                        return jsonResponse({
                            ...queued,
                            immediate: false,
                            executed: false,
                            queued_only: true,
                            execute_via: 'cron',
                            message: 'task queued, waiting cron worker to execute'
                        });
                    } catch (e) {
                        return await auditErrorResponse(
                            env,
                            request,
                            String(e?.message || 'ai run failed'),
                            500,
                            5301,
                            {
                                reason: payload.reason,
                                immediate: body.immediate === true,
                                execution_mode: payload.execution_mode
                            },
                            'admin.ai.run'
                        );
                    }
                }

                if (url.pathname === '/api/admin/ai/pending') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.pending');
                    const status = asTrimmed(url.searchParams.get('status'));
                    const page = Number(url.searchParams.get('page') || 1);
                    const pageSize = Number(url.searchParams.get('page_size') || 20);
                    return jsonResponse(await getAiPendingActions(env, {
                        status,
                        page,
                        page_size: pageSize
                    }));
                }

                if (url.pathname === '/api/admin/ai/pending/confirm') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.pending.confirm');
                    const body = await parseBody(request) || {};
                    try {
                        return jsonResponse(await confirmAiPendingActions(env, body));
                    } catch (e) {
                        return await auditErrorResponse(env, request, String(e?.message || 'pending confirm failed'), 400, 4303, {}, 'admin.ai.pending.confirm');
                    }
                }

                if (url.pathname === '/api/admin/ai/pending/reject') {
                    if (method !== 'POST') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.pending.reject');
                    const body = await parseBody(request) || {};
                    try {
                        return jsonResponse(await rejectAiPendingActions(env, body));
                    } catch (e) {
                        return await auditErrorResponse(env, request, String(e?.message || 'pending reject failed'), 400, 4304, {}, 'admin.ai.pending.reject');
                    }
                }

                if (url.pathname === '/api/admin/ai/tasks') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.ai.tasks');
                    const status = asTrimmed(url.searchParams.get('status'));
                    const page = Number(url.searchParams.get('page') || 1);
                    const pageSize = Number(url.searchParams.get('page_size') || 20);
                    const includeResult = url.searchParams.get('include_result') === '1';
                    return jsonResponse(await getAiTasks(env, {
                        status,
                        page,
                        page_size: pageSize,
                        include_result: includeResult
                    }));
                }

                if (url.pathname === '/api/admin/audit') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.audit');
                    return await handleAuditQuery(env, url);
                }

                if (url.pathname === '/api/admin/integrity') {
                    if (method !== 'GET') return await auditErrorResponse(env, request, 'Method Not Allowed', 405, 4050, {}, 'admin.integrity');
                    return await handleIntegrityQuery(env);
                }
            }

            return await auditErrorResponse(env, request, 'Not Found', 404, 4040, {}, 'http');
        } catch (e) {
            console.error('Unhandled Error', e);
            await logError(env, e, { path: url.pathname, method }, 'fetch');
            return errorResponse('Internal Server Error', 500, 5000);
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduled(event, env));
    }
};
