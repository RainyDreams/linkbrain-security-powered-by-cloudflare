import { matchOrders } from './trade.js';
import { Money, Time } from './utils.js';
import { fetchStockPrice } from './market.js';
import { ensureRuntimeSchema } from './db.js';

const acquireDailyJobLock = async (env, jobName, cstDate) => {
    const lockKey = `${jobName}:${cstDate}`;
    const res = await env.DB.prepare(
        'INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).bind(lockKey, '1').run();
    return (res?.meta?.changes || 0) > 0;
};

export const handleScheduled = async (event, env) => {
    await ensureRuntimeSchema(env);

    const cst = Time.getCST();
    const day = cst.getDay();
    const hour = cst.getHours();
    const min = cst.getMinutes();
    const timeValue = hour * 100 + min;
    const cstDate = Time.formatCSTDate(cst);

    if (day === 0 || day === 6) return;

    const isTradingSession =
        (timeValue >= 930 && timeValue <= 1130) ||
        (timeValue >= 1300 && timeValue <= 1500);

    if (isTradingSession) {
        await matchOrders(env);
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
};

async function dailyClosingProcess(env, cstDate) {
    const { results: pendings } = await env.DB.prepare("SELECT * FROM orders WHERE status='PENDING'").all();
    for (const order of pendings) {
        const expireRes = await env.DB.prepare(
            "UPDATE orders SET status='EXPIRED', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'"
        ).bind(order.id).run();
        if ((expireRes?.meta?.changes || 0) === 0) continue;

        if (order.side === 'BUY') {
            await env.DB.prepare(
                'UPDATE account SET frozen_balance = CASE WHEN frozen_balance >= ? THEN frozen_balance - ? ELSE 0 END WHERE id=1'
            ).bind(order.freeze_amount, order.freeze_amount).run();
        } else {
            await env.DB.prepare(
                'UPDATE holdings SET available_qty = MIN(quantity, available_qty + ?) WHERE symbol=?'
            ).bind(order.qty, order.symbol).run();
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

