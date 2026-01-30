// src/trade.js
import { jsonResponse, errorResponse, Money, Time } from './utils.js';
import { fetchStockPrice } from './market.js';

export const placeOrder = async (env, body) => {
    const { symbol, side, price, qty } = body;
    const marketData = await fetchStockPrice(symbol);
    if (!marketData) return errorResponse("无法获取行情", 400, 4005);

    const priceCent = Money.toCent(price);
    const totalAmt = priceCent * qty;

    if (side === 'BUY') {
        const fee = Money.calcCommission(totalAmt);
        const freeze = totalAmt + fee;
        
        const res = await env.DB.batch([
            env.DB.prepare("UPDATE account SET frozen_balance = frozen_balance + ? WHERE id=1 AND (balance - frozen_balance) >= ?").bind(freeze, freeze),
            env.DB.prepare("INSERT INTO orders (symbol, name, side, price, qty, freeze_amount, status) VALUES (?, ?, 'BUY', ?, ?, ?, 'PENDING')")
                .bind(marketData.symbol, marketData.name, priceCent, qty, freeze)
        ]);
        if (res[0].meta.changes === 0) return errorResponse("可用资金不足", 400, 4001);
    } else {
        const res = await env.DB.batch([
            env.DB.prepare("UPDATE holdings SET available_qty = available_qty - ? WHERE symbol=? AND available_qty >= ?").bind(qty, symbol, qty),
            env.DB.prepare("INSERT INTO orders (symbol, name, side, price, qty, status) VALUES (?, ?, 'SELL', ?, ?, 'PENDING')")
                .bind(marketData.symbol, marketData.name, priceCent, qty)
        ]);
        if (res[0].meta.changes === 0) return errorResponse("可用持仓不足", 400, 4002);
    }

    return jsonResponse({ message: "委托已提交" });
};

export const cancelOrder = async (env, orderId) => {
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=? AND status='PENDING'").bind(orderId).first();
    if (!order) return errorResponse("订单不可撤销", 400);

    const stmts = [
        env.DB.prepare("UPDATE orders SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(orderId)
    ];
    
    if (order.side === 'BUY') {
        stmts.push(env.DB.prepare("UPDATE account SET frozen_balance = frozen_balance - ? WHERE id=1").bind(order.freeze_amount));
    } else {
        stmts.push(env.DB.prepare("UPDATE holdings SET available_qty = available_qty + ? WHERE symbol=?").bind(order.qty, order.symbol));
    }
    
    await env.DB.batch(stmts);
    return jsonResponse({ message: "撤单成功" });
};

export const matchOrders = async (env) => {
    // 关键修复：休市期间不进行撮合
    if (!Time.isMarketOpen()) {
        console.log("Market Closed. Skipping match.");
        return; 
    }

    const { results: orders } = await env.DB.prepare("SELECT * FROM orders WHERE status='PENDING'").all();
    if (orders.length === 0) return;

    // 批量获取行情
    const symbols = [...new Set(orders.map(o => o.symbol))];
    const prices = {};
    for (const s of symbols) {
        const d = await fetchStockPrice(s);
        if (d) prices[s] = Money.toCent(d.price);
    }

    for (const o of orders) {
        const curr = prices[o.symbol];
        if (!curr) continue;

        // 简易撮合：买单价格 >= 现价，卖单价格 <= 现价
        const isMatch = o.side === 'BUY' ? (o.price >= curr) : (o.price <= curr);
        
        if (isMatch) {
            await executeTrade(env, o, curr);
        }
    }
};

// src/trade.js 里的 executeTrade 函数

// src/trade.js 完整替换 executeTrade 函数

// src/trade.js 完整替换 executeTrade 函数

async function executeTrade(env, order, exePrice) {
    const tradeAmt = exePrice * order.qty;
    const fee = Money.calcCommission(tradeAmt);
    const tax = order.side === 'SELL' ? Money.calcTax(tradeAmt) : 0;
    const totalSettlement = order.side === 'BUY' ? (tradeAmt + fee) : (tradeAmt - fee - tax);

    // 1. 获取当前账户和持仓，用于计算占比
    const acc = await env.DB.prepare("SELECT balance, frozen_balance FROM account WHERE id = 1").first();
    const { results: allHoldings } = await env.DB.prepare("SELECT symbol, quantity, avg_cost FROM holdings").all();
    
    let totalMarketCap = 0;
    let targetOldQty = 0;
    for (const h of allHoldings) {
        if (h.symbol === order.symbol) targetOldQty = h.quantity;
        totalMarketCap += h.quantity * (h.symbol === order.symbol ? exePrice : h.avg_cost);
    }

    const totalAssetsBefore = acc.balance + acc.frozen_balance + totalMarketCap;
    
    // 2. 计算成交前后的占比 (转为百分比数值)
    const prePosRatio = totalAssetsBefore > 0 ? parseFloat(((targetOldQty * exePrice / totalAssetsBefore) * 100).toFixed(2)) : 0;
    const newQty = order.side === 'BUY' ? (targetOldQty + order.qty) : (targetOldQty - order.qty);
    const postPosRatio = totalAssetsBefore > 0 ? parseFloat(((newQty * exePrice / totalAssetsBefore) * 100).toFixed(2)) : 0;

    const stmts = [
        env.DB.prepare("UPDATE orders SET status = 'FILLED', filled_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(order.qty, order.id)
    ];

    if (order.side === 'BUY') {
        // 扣款逻辑 (balance 包含总现金)
        stmts.push(env.DB.prepare("UPDATE account SET balance = balance - ?, frozen_balance = frozen_balance - ? WHERE id = 1")
            .bind(totalSettlement, order.freeze_amount));
        
        const oldH = await env.DB.prepare("SELECT total_cost, quantity FROM holdings WHERE symbol = ?").bind(order.symbol).first();
        if (oldH) {
            const nQty = oldH.quantity + order.qty;
            const nCost = oldH.total_cost + totalSettlement;
            stmts.push(env.DB.prepare("UPDATE holdings SET quantity=?, total_cost=?, avg_cost=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=?")
                .bind(nQty, nCost, Math.round(nCost / nQty), order.symbol));
        } else {
            stmts.push(env.DB.prepare("INSERT INTO holdings (symbol, name, quantity, available_qty, avg_cost, total_cost) VALUES (?, ?, ?, 0, ?, ?)")
                .bind(order.symbol, order.name, order.qty, Math.round(totalSettlement / order.qty), totalSettlement));
        }
    } else {
        // 卖出逻辑
        stmts.push(env.DB.prepare("UPDATE account SET balance = balance + ? WHERE id = 1").bind(totalSettlement));
        if (targetOldQty > order.qty) {
            const nQty = targetOldQty - order.qty;
            const hInfo = allHoldings.find(x => x.symbol === order.symbol);
            const nCost = Math.round(hInfo.avg_cost * nQty);
            stmts.push(env.DB.prepare("UPDATE holdings SET quantity = ?, total_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?")
                .bind(nQty, nCost, order.symbol));
        } else {
            stmts.push(env.DB.prepare("DELETE FROM holdings WHERE symbol = ?").bind(order.symbol));
        }
    }

    // 3. 记录流水 (确保包含 pre_pos_ratio)
    stmts.push(env.DB.prepare(`
        INSERT INTO trades (order_id, symbol, name, side, price, qty, amount, commission, tax, pre_pos_ratio, post_pos_ratio) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(order.id, order.symbol, order.name, order.side, exePrice, order.qty, tradeAmt, fee, tax, prePosRatio, postPosRatio));

    await env.DB.batch(stmts);
}