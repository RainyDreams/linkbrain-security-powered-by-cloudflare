import { matchOrders } from './trade.js';
import { Money, Time } from './utils.js';
import { fetchStockPrice } from './market.js';
import { ensureRuntimeSchema, withTransaction } from './db.js';
import { logBizError, logError } from './audit.js';
import { runAiCommittee, runQueuedAiTasks } from './ai_committee.js';

const AI_CRON_WINDOWS = Object.freeze([935, 1045, 1335, 1425, 2100]);

const shouldTriggerAiDiscussion = (cst) => {
    const day = cst.getDay();
    if (day === 0 || day === 6) return false;
    const hhmm = (cst.getHours() * 100) + cst.getMinutes();
    return AI_CRON_WINDOWS.includes(hhmm);
};

const acquireDailyJobLock = async (env, jobName, cstDate) => {
    const lockKey = `${jobName}:${cstDate}`;
    const res = await env.DB.prepare(
        'INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).bind(lockKey, '1').run();
    return (res?.meta?.changes || 0) > 0;
};

export const handleScheduled = async (event, env) => {
    try {
        await ensureRuntimeSchema(env);

        const cst = Time.getCST();
        const day = cst.getDay();
        const hour = cst.getHours();
        const min = cst.getMinutes();
        const timeValue = hour * 100 + min;
        const cstDate = Time.formatCSTDate(cst);

        await recoverStuckOrders(env);
        await reconcileFrozenBalance(env);
        await runQueuedAiTasks(env, { max_tasks: 2 });

        if (day === 0 || day === 6) return;

        const isTradingSession = Time.isContinuousAuction(cst);

        if (isTradingSession) {
            await matchOrders(env);
        }

        if (shouldTriggerAiDiscussion(cst)) {
            await runAiCommittee(env, { trigger: 'cron' });
        }

        if (timeValue >= 1505 && timeValue <= 1510) {
            const locked = await acquireDailyJobLock(env, 'close', cstDate);
            if (locked) {
                await dailyClosingProcess(env, cstDate);
            }
        }

        if (timeValue >= 1 && timeValue <= 5) {
            const locked = await acquireDailyJobLock(env, 'settle', cstDate);
            if (locked) {
                await env.DB.prepare('UPDATE holdings SET available_qty = quantity WHERE available_qty <> quantity').run();
                console.log('T+1 Settlement: available_qty updated.');
            }
        }
    } catch (e) {
        await logError(env, e, { cron: event?.cron || 'unknown' }, 'cron');
        console.error('Scheduled job error', e);
    }
};

const recoverStuckOrders = async (env) => {
    const { results: stuck } = await env.DB.prepare(`
        SELECT id
        FROM orders
        WHERE status = 'MATCHING'
          AND updated_at <= datetime('now', '-2 minutes')
        ORDER BY id ASC
        LIMIT 200
    `).all();

    for (const row of stuck) {
        const res = await env.DB.prepare(
            "UPDATE orders SET status='PENDING', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='MATCHING'"
        ).bind(row.id).run();
        if ((res?.meta?.changes || 0) > 0) {
            await logBizError(env, {
                status: 409,
                message: 'matching timeout -> requeue',
                scope: 'order.recover',
                meta: { order_id: row.id }
            });
        }
    }
};

const reconcileFrozenBalance = async (env) => {
    const sumRow = await env.DB.prepare(
        "SELECT COALESCE(SUM(freeze_amount), 0) AS total FROM orders WHERE side='BUY' AND status IN ('PENDING', 'MATCHING')"
    ).first();
    const totalFrozen = Number(sumRow?.total || 0);
    const acc = await env.DB.prepare('SELECT frozen_balance FROM account WHERE id=1').first();
    const current = Number(acc?.frozen_balance || 0);
    if (current !== totalFrozen) {
        await env.DB.prepare('UPDATE account SET frozen_balance=? WHERE id=1').bind(totalFrozen).run();
        await logBizError(env, {
            level: 'INFO',
            status: 200,
            message: 'reconcile frozen_balance',
            scope: 'account.reconcile',
            meta: { before: current, after: totalFrozen }
        });
    }
};

async function dailyClosingProcess(env, cstDate) {
    const { results: pendings } = await env.DB.prepare("SELECT * FROM orders WHERE status='PENDING'").all();
    for (const order of pendings) {
        try {
            await withTransaction(env, async () => {
                const expireRes = await env.DB.prepare(
                    "UPDATE orders SET status='EXPIRED', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'"
                ).bind(order.id).run();
                if ((expireRes?.meta?.changes || 0) === 0) return;

                if (order.side === 'BUY') {
                    const releaseRes = await env.DB.prepare(
                        'UPDATE account SET frozen_balance = frozen_balance - ? WHERE id=1 AND frozen_balance >= ?'
                    ).bind(order.freeze_amount, order.freeze_amount).run();
                    if ((releaseRes?.meta?.changes || 0) === 0) {
                        throw new Error('release frozen balance failed on expire');
                    }
                } else {
                    const releaseRes = await env.DB.prepare(
                        'UPDATE holdings SET available_qty = MIN(quantity, available_qty + ?) WHERE symbol=?'
                    ).bind(order.qty, order.symbol).run();
                    if ((releaseRes?.meta?.changes || 0) === 0) {
                        throw new Error('release holdings failed on expire');
                    }
                }
            });
        } catch (e) {
            await logError(env, e, { order_id: order.id, side: order.side }, 'order.expire');
        }
    }

    const account = await env.DB.prepare('SELECT balance, initial_capital FROM account WHERE id=1').first();
    const { results: holdings } = await env.DB.prepare('SELECT symbol, quantity FROM holdings WHERE quantity > 0').all();

    let marketCap = 0;
    for (const h of holdings) {
        const m = await fetchStockPrice(h.symbol);
        if (m) marketCap += Money.toCent(m.price) * h.quantity;
    }

    const totalAssets = account.balance + marketCap;
    const prevSnap = await env.DB.prepare(
        'SELECT total_assets FROM snapshots WHERE date < ? ORDER BY date DESC LIMIT 1'
    ).bind(cstDate).first();
    const prevTotal = prevSnap?.total_assets || account.initial_capital;
    const dayPnl = totalAssets - prevTotal;
    const totalReturnRate = account.initial_capital > 0
        ? parseFloat((((totalAssets - account.initial_capital) / account.initial_capital) * 100).toFixed(2))
        : 0;

    await env.DB.prepare(`
        INSERT OR REPLACE INTO snapshots (date, total_assets, day_pnl, total_return_rate, max_drawdown)
        VALUES (?, ?, ?, ?, 0)
    `).bind(cstDate, totalAssets, dayPnl, totalReturnRate).run();

    console.log(`Closing Process Done: ${cstDate} Assets ${totalAssets}`);
}

