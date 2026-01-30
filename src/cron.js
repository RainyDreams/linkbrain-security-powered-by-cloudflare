import { matchOrders } from './trade.js';
import { Money, Time } from './utils.js';
import { fetchStockPrice } from './market.js';

export const handleScheduled = async (event, env) => {
    const now = new Date();
    // 获取北京时间 (CST)
    const cstStr = now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
    const cst = new Date(cstStr);
    
    const day = cst.getDay(); // 0:周日, 6:周六
    const hour = cst.getHours();
    const min = cst.getMinutes();
    const timeValue = hour * 100 + min; // 格式如 1505

    // 辩证处理：周六日不执行任何交易逻辑
    if (day === 0 || day === 6) return;

    // --- 1. 盘中撮合逻辑 (09:30-11:30, 13:00-15:00) ---
    const isTradingSession = 
        (timeValue >= 930 && timeValue <= 1130) || 
        (timeValue >= 1300 && timeValue <= 1500);

    if (isTradingSession) {
        await matchOrders(env);
    }

    // --- 2. 收盘处理 (15:05) ---
    // 废单撤销 + 资产快照
    if (timeValue === 1505) {
        await dailyClosingProcess(env);
    }

    // --- 3. T+1 结算 (00:01) ---
    // 解冻持仓，使其变为可卖
    if (timeValue === 1) {
        await env.DB.prepare("UPDATE holdings SET available_qty = quantity").run();
        console.log("T+1 Settlement: available_qty updated.");
    }
};

/**
 * 收盘流程：撤单与快照
 */
async function dailyClosingProcess(env) {
    // 1. 撤销所有未成交单 (回滚资金/持仓)
    const { results: pendings } = await env.DB.prepare("SELECT * FROM orders WHERE status='PENDING'").all();
    for (const order of pendings) {
        // 这里可以直接调用已有的 cancelOrder 逻辑
        const stmts = [
            env.DB.prepare("UPDATE orders SET status='EXPIRED', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(order.id)
        ];
        if (order.side === 'BUY') {
            stmts.push(env.DB.prepare("UPDATE account SET frozen_balance = frozen_balance - ? WHERE id=1").bind(order.freeze_amount));
        } else {
            stmts.push(env.DB.prepare("UPDATE holdings SET available_qty = available_qty + ? WHERE symbol=?").bind(order.qty, order.symbol));
        }
        await env.DB.batch(stmts);
    }

    // 2. 生成每日资产快照 (Spec 3.3)
    const account = await env.DB.prepare("SELECT balance FROM account WHERE id=1").first();
    const { results: holdings } = await env.DB.prepare("SELECT symbol, quantity FROM holdings WHERE quantity > 0").all();
    
    let marketCap = 0;
    for (const h of holdings) {
        const m = await fetchStockPrice(h.symbol);
        if (m) marketCap += Money.toCent(m.price) * h.quantity;
    }
    
    const totalAssets = account.balance + marketCap;
    const dateStr = new Date().toISOString().split('T')[0];
    
    await env.DB.prepare("INSERT OR REPLACE INTO snapshots (date, total_assets) VALUES (?, ?)")
        .bind(dateStr, totalAssets).run();
    
    console.log(`Closing Process Done: Assets ${totalAssets}`);
}