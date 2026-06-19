/* eslint-disable no-console */
import { jsonResponse, errorResponse, Money, Time } from './utils.js';
import { fetchStockPrice } from './market.js';
import { withTransaction } from './db.js';
import { logTechnicalAudit, logFinancialAudit, logBizError } from './audit.js';

const DEBUG_HEADER = 'x-debug-key';

const safeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

export const verifyDebugKey = (request, env) => {
    const expected = String(env?.DEBUG_KEY || '').trim();
    if (!expected) return false;
    const got = request.headers.get(DEBUG_HEADER) || request.headers.get('X-Debug-Key') || '';
    return safeEqual(String(got).trim(), expected);
};

export const isDebugEnabled = (env) => !!String(env?.DEBUG_KEY || '').trim();

export const debugStatusResponse = (env) => ({
    enabled: isDebugEnabled(env),
    features: {
        simulate_match: true,
        skip_risk_gates: true,
        skip_trading_session: true,
        force_run_cron: true
    },
    header_name: 'X-Debug-Key'
});

export const handleDebugVerify = (request, env) => {
    if (!isDebugEnabled(env)) {
        return errorResponse('Debug 模式未启用（缺少 DEBUG_KEY）', 403, 9001);
    }
    if (!verifyDebugKey(request, env)) {
        return errorResponse('Debug 密钥错误', 401, 9002);
    }
    return jsonResponse({ ok: true, ...debugStatusResponse(env) });
};

/**
 * Simulate a match of pending orders without using live prices.
 * Debug only: requires X-Debug-Key header.
 * Reads PENDING orders, fills them at a synthetic price derived from order price (small random walk).
 */
export const handleDebugSimulateMatch = async (request, env, ctx) => {
    if (!isDebugEnabled(env)) return errorResponse('Debug 模式未启用', 403, 9001);
    if (!verifyDebugKey(request, env)) return errorResponse('Debug 密钥错误', 401, 9002);

    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const skipTradingSession = body?.skip_trading_session !== false; // default true
    const useOrderPrice = body?.use_order_price !== false; // default true
    const syntheticDelta = Number(body?.synthetic_delta ?? 0);
    const seed = Number.isFinite(Number(body?.seed)) ? Number(body.seed) : Date.now();

    if (skipTradingSession && !Time.isContinuousAuction()) {
        // skip — debug mode can force match regardless of session
    }

    const { results: orders } = await env.DB.prepare(
        "SELECT * FROM orders WHERE status='PENDING' ORDER BY id ASC"
    ).all();

    if (!orders.length) return jsonResponse({ skipped: false, checked: 0, triggered: 0, simulated: 0, runs: [] });

    let triggered = 0;
    let simulated = 0;
    const runs = [];
    for (const o of orders) {
        const exePrice = useOrderPrice ? Number(o.price || 0) : Math.max(1, Number(o.price || 0) + syntheticDelta);
        if (!Number.isInteger(exePrice) || exePrice <= 0) continue;

        const orderId = Number(o.id);
        const claimRes = await env.DB.prepare(
            "UPDATE orders SET status='MATCHING', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'"
        ).bind(orderId).run();
        if (!claimRes?.meta?.changes) continue;
        triggered += 1;

        try {
            await withTransaction(env, async () => {
                const freshOrder = await env.DB.prepare(
                    "SELECT * FROM orders WHERE id=? AND status='MATCHING'"
                ).bind(orderId).first();
                if (!freshOrder) throw new Error('order not found in matching state');
                const qty = Number(freshOrder.qty);
                const tradeAmt = exePrice * qty;
                const fee = Money.calcCommission(tradeAmt);
                const tax = freshOrder.side === 'SELL' ? Money.calcTax(tradeAmt) : 0;
                const totalSettlement = freshOrder.side === 'BUY' ? (tradeAmt + fee) : (tradeAmt - fee - tax);

                if (freshOrder.side === 'BUY') {
                    const payRes = await env.DB.prepare(
                        'UPDATE account SET balance = balance - ?, frozen_balance = frozen_balance - ? WHERE id = 1 AND balance >= ? AND frozen_balance >= ?'
                    ).bind(totalSettlement, freshOrder.freeze_amount, totalSettlement, freshOrder.freeze_amount).run();
                    if (!payRes?.meta?.changes) throw new Error('debug settle buy failed');
                    const oldH = await env.DB.prepare('SELECT total_cost, quantity FROM holdings WHERE symbol=?').bind(freshOrder.symbol).first();
                    if (oldH) {
                        const nQty = Number(oldH.quantity || 0) + qty;
                        const nCost = Number(oldH.total_cost || 0) + totalSettlement;
                        const nAvg = Math.round(nCost / nQty);
                        await env.DB.prepare('UPDATE holdings SET quantity=?, total_cost=?, avg_cost=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=?')
                            .bind(nQty, nCost, nAvg, freshOrder.symbol).run();
                    } else {
                        await env.DB.prepare(
                            'INSERT INTO holdings (symbol, name, quantity, available_qty, avg_cost, total_cost) VALUES (?, ?, ?, 0, ?, ?)'
                        ).bind(freshOrder.symbol, freshOrder.name, qty, Math.round(totalSettlement / qty), totalSettlement).run();
                    }
                } else {
                    const hInfo = await env.DB.prepare(
                        'SELECT quantity, available_qty, avg_cost FROM holdings WHERE symbol=?'
                    ).bind(freshOrder.symbol).first();
                    if (!hInfo || Number(hInfo.quantity || 0) < qty) throw new Error('debug settle sell insufficient');
                    if (Number(hInfo.quantity || 0) > qty) {
                        const nQty = Number(hInfo.quantity || 0) - qty;
                        const nCost = Math.round(Number(hInfo.avg_cost || 0) * nQty);
                        const nAvailable = Math.min(Number(hInfo.available_qty || 0), nQty);
                        await env.DB.prepare(
                            'UPDATE holdings SET quantity = ?, available_qty = ?, total_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?'
                        ).bind(nQty, nAvailable, nCost, freshOrder.symbol).run();
                    } else {
                        await env.DB.prepare('DELETE FROM holdings WHERE symbol = ?').bind(freshOrder.symbol).run();
                    }
                    await env.DB.prepare(
                        'UPDATE account SET balance = balance + ? WHERE id = 1'
                    ).bind(totalSettlement).run();
                }

                await env.DB.prepare(
                    `INSERT INTO trades (order_id, symbol, name, side, price, qty, amount, commission, tax, pre_pos_ratio, post_pos_ratio)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    freshOrder.id, freshOrder.symbol, freshOrder.name, freshOrder.side,
                    exePrice, qty, tradeAmt, fee, tax, 0, 0
                ).run();

                await env.DB.prepare(
                    "UPDATE orders SET status='FILLED', filled_qty=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='MATCHING'"
                ).bind(qty, freshOrder.id).run();

                simulated += 1;
                runs.push({
                    order_id: orderId, symbol: freshOrder.symbol, side: freshOrder.side,
                    qty, price: exePrice, amount: tradeAmt
                });

                await logFinancialAudit(env, {
                    event_type: 'TRADE_EXECUTE',
                    scope: 'debug.match',
                    category: 'trade',
                    subcategory: freshOrder.side,
                    tags: ['trade', 'execute', 'debug'],
                    status: 'SUCCESS',
                    order_id: freshOrder.id,
                    symbol: freshOrder.symbol,
                    side: freshOrder.side,
                    qty,
                    price: exePrice,
                    amount: tradeAmt,
                    fee,
                    tax,
                    message: 'debug simulate match executed',
                    meta: { synthetic: true, seed, use_order_price: useOrderPrice, delta: syntheticDelta }
                });
            });
        } catch (e) {
            await env.DB.prepare(
                "UPDATE orders SET status='ERROR', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='MATCHING'"
            ).bind(orderId).run();
            await logBizError(env, {
                level: 'ERROR',
                status: 500,
                scope: 'debug.match',
                category: 'trade',
                subcategory: 'simulate',
                message: 'debug simulate match failed',
                meta: { order_id: orderId, error: String(e?.message || e) }
            });
        }
    }

    await logTechnicalAudit(env, {
        level: 'INFO',
        scope: 'debug.match',
        category: 'debug',
        subcategory: 'simulate_match',
        status: 'SUCCESS',
        message: 'debug simulate match run',
        meta: { checked: orders.length, triggered, simulated, seed, skip_trading_session: skipTradingSession, use_order_price: useOrderPrice, delta: syntheticDelta }
    });

    return jsonResponse({
        skipped: false,
        checked: orders.length,
        triggered,
        simulated,
        seed,
        runs
    });
};

/**
 * Cleanup old logs to keep the DB small.
 * Defaults: technical/financial audit older than 90 days, login_attempts older than 30 days.
 */
export const handleDebugCleanupLogs = async (request, env) => {
    if (!isDebugEnabled(env)) return errorResponse('Debug 模式未启用', 403, 9001);
    if (!verifyDebugKey(request, env)) return errorResponse('Debug 密钥错误', 401, 9002);

    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    // 全部日志默认保留 30 天（除 AI 详情 7 天）
    const auditDays = Math.max(1, Math.min(3650, Number(body?.audit_days ?? 30)));
    const loginDays = Math.max(1, Math.min(365, Number(body?.login_days ?? 30)));
    const pendingTaskDays = Math.max(1, Math.min(365, Number(body?.task_days ?? 30)));
    const runRecordDays = Math.max(1, Math.min(730, Number(body?.run_record_days ?? 30)));
    const newsDays = Math.max(1, Math.min(60, Number(body?.news_days ?? 7)));
    const transferDays = Math.max(1, Math.min(365, Number(body?.transfer_days ?? 30)));
    const commentDays = Math.max(1, Math.min(365, Number(body?.comment_days ?? 30)));

    const purge = async (sql, params) => {
        try {
            const r = await env.DB.prepare(sql).bind(...params).run();
            return Number(r?.meta?.changes || 0);
        } catch { return 0; }
    };

    const summary = {
        audit_technical: await purge(
            "DELETE FROM audit_technical WHERE created_at_cst IS NOT NULL AND created_at_cst < datetime('now', '+8 hours', ?)",
            [`-${auditDays} days`]
        ),
        audit_financial: await purge(
            "DELETE FROM audit_financial WHERE created_at_cst IS NOT NULL AND created_at_cst < datetime('now', '+8 hours', ?)",
            [`-${auditDays} days`]
        ),
        login_attempts: await purge(
            "DELETE FROM login_attempts WHERE updated_at < datetime('now', ?)",
            [`-${loginDays} days`]
        ),
        ai_tasks: await purge(
            "DELETE FROM ai_committee_tasks WHERE finished_at IS NOT NULL AND finished_at < datetime('now', ?)",
            [`-${pendingTaskDays} days`]
        ),
        ai_runs: await purge(
            "DELETE FROM ai_committee_runs WHERE created_at_cst IS NOT NULL AND created_at_cst < datetime('now', '+8 hours', ?)",
            [`-${runRecordDays} days`]
        ),
        ai_rss_cache: await purge(
            "DELETE FROM meta WHERE key='ai.rss.cache' AND updated_at < datetime('now', ?)",
            [`-${newsDays} days`]
        ),
        bank_transfers: await purge(
            "DELETE FROM bank_transfers WHERE created_at IS NOT NULL AND created_at < datetime('now', ?)",
            [`-${transferDays} days`]
        ),
        comments: await purge(
            "DELETE FROM comments WHERE created_at IS NOT NULL AND created_at < datetime('now', ?)",
            [`-${commentDays} days`]
        )
    };

    await logTechnicalAudit(env, {
        level: 'INFO',
        scope: 'debug.cleanup',
        category: 'debug',
        subcategory: 'purge',
        status: 'SUCCESS',
        message: 'debug log cleanup run',
        meta: { summary, params: { auditDays, loginDays, pendingTaskDays, runRecordDays, newsDays, transferDays, commentDays } }
    });

    return jsonResponse({ ok: true, summary, params: { auditDays, loginDays, pendingTaskDays, runRecordDays, newsDays, transferDays, commentDays } });
};