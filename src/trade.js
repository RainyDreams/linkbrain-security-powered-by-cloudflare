// src/trade.js
import { jsonResponse, errorResponse, Money, Time, TradeRules } from './utils.js';
import { fetchStockPrice } from './market.js';
import { withTransaction } from './db.js';

const ORDER_SIDES = new Set(['BUY', 'SELL']);

const dbChanges = (result) => result?.meta?.changes ?? 0;

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

const getLimitPct = (fullSymbol) => {
    const code = String(fullSymbol).replace(/^(sh|sz)/, '');
    if (code.startsWith('300') || code.startsWith('688')) return 0.2;
    return 0.1;
};

const validateOrderInput = (body, marketData) => {
    if (!body || typeof body !== 'object') return { ok: false, message: '参数错误' };

    const side = String(body.side || '').toUpperCase();
    if (!ORDER_SIDES.has(side)) return { ok: false, message: 'side 仅支持 BUY/SELL' };

    const qty = Number(body.qty);
    if (!isPositiveInteger(qty)) return { ok: false, message: 'qty 必须为正整数' };
    if (qty % TradeRules.MIN_LOT_SIZE !== 0) {
        return { ok: false, message: `qty 必须为 ${TradeRules.MIN_LOT_SIZE} 的整数倍` };
    }
    if (qty > TradeRules.MAX_ORDER_QTY) return { ok: false, message: 'qty 超出限制' };

    if (!Money.hasAtMostTwoDecimals(body.price)) return { ok: false, message: 'price 最多支持 2 位小数' };
    const priceCent = Money.toCent(body.price);
    if (!isPositiveInteger(priceCent)) return { ok: false, message: 'price 必须大于 0' };

    const symbol = marketData?.symbol;
    if (!symbol || !/^(sh|sz)\d{6}$/.test(symbol)) return { ok: false, message: 'symbol 非法' };

    const referenceCent = Money.toCent(marketData.prevClose || marketData.price);
    if (isPositiveInteger(referenceCent)) {
        const limitPct = getLimitPct(symbol);
        const minPrice = Math.max(1, Math.floor(referenceCent * (1 - limitPct)));
        const maxPrice = Math.ceil(referenceCent * (1 + limitPct));
        if (priceCent < minPrice || priceCent > maxPrice) {
            return { ok: false, message: '委托价超出涨跌停价格区间' };
        }
    }

    return {
        ok: true,
        side,
        qty,
        priceCent,
        symbol,
        name: marketData.name
    };
};

export const placeOrder = async (env, body) => {
    const symbolInput = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
    if (!symbolInput) return errorResponse('symbol 不能为空', 400, 4007);

    const marketData = await fetchStockPrice(symbolInput);
    if (!marketData) return errorResponse('无法获取行情', 400, 4005);

    const validated = validateOrderInput(body, marketData);
    if (!validated.ok) return errorResponse(validated.message, 400, 4008);

    const { symbol, name, side, qty, priceCent } = validated;
    const totalAmt = priceCent * qty;
    if (!isPositiveInteger(totalAmt)) return errorResponse('委托金额非法', 400, 4009);

    if (side === 'BUY') {
        const fee = Money.calcCommission(totalAmt);
        const freeze = totalAmt + fee;

        const freezeRes = await env.DB.prepare(
            'UPDATE account SET frozen_balance = frozen_balance + ? WHERE id=1 AND (balance - frozen_balance) >= ?'
        ).bind(freeze, freeze).run();
        if (dbChanges(freezeRes) === 0) return errorResponse('可用资金不足', 400, 4001);

        try {
            await env.DB.prepare(
                "INSERT INTO orders (symbol, name, side, price, qty, freeze_amount, status) VALUES (?, ?, 'BUY', ?, ?, ?, 'PENDING')"
            ).bind(symbol, name, priceCent, qty, freeze).run();
        } catch (e) {
            await env.DB.prepare(
                'UPDATE account SET frozen_balance = frozen_balance - ? WHERE id=1 AND frozen_balance >= ?'
            ).bind(freeze, freeze).run();
            throw e;
        }
    } else {
        const holdRes = await env.DB.prepare(
            'UPDATE holdings SET available_qty = available_qty - ? WHERE symbol=? AND available_qty >= ? AND quantity >= ?'
        ).bind(qty, symbol, qty, qty).run();
        if (dbChanges(holdRes) === 0) return errorResponse('可用持仓不足', 400, 4002);

        try {
            await env.DB.prepare(
                "INSERT INTO orders (symbol, name, side, price, qty, status) VALUES (?, ?, 'SELL', ?, ?, 'PENDING')"
            ).bind(symbol, name, priceCent, qty).run();
        } catch (e) {
            await env.DB.prepare(
                'UPDATE holdings SET available_qty = MIN(quantity, available_qty + ?) WHERE symbol=?'
            ).bind(qty, symbol).run();
            throw e;
        }
    }

    return jsonResponse({ message: '委托已提交' });
};

export const cancelOrder = async (env, orderId) => {
    const id = Number(orderId);
    if (!isPositiveInteger(id)) return errorResponse('order_id 非法', 400, 4010);

    const order = await env.DB.prepare(
        "SELECT id, side, qty, symbol, freeze_amount FROM orders WHERE id=? AND status='PENDING'"
    ).bind(id).first();
    if (!order) return errorResponse('订单不可撤销', 400, 4003);

    const cancelRes = await env.DB.prepare(
        "UPDATE orders SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'"
    ).bind(id).run();
    if (dbChanges(cancelRes) === 0) return errorResponse('订单不可撤销', 400, 4003);

    if (order.side === 'BUY') {
        const releaseRes = await env.DB.prepare(
            'UPDATE account SET frozen_balance = frozen_balance - ? WHERE id=1 AND frozen_balance >= ?'
        ).bind(order.freeze_amount, order.freeze_amount).run();
        if (dbChanges(releaseRes) === 0) {
            await env.DB.prepare(
                "UPDATE orders SET status='PENDING', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='CANCELLED'"
            ).bind(id).run();
            return errorResponse('资金释放失败，已回滚撤单', 500, 5002);
        }
    } else {
        const releaseRes = await env.DB.prepare(
            'UPDATE holdings SET available_qty = MIN(quantity, available_qty + ?) WHERE symbol=?'
        ).bind(order.qty, order.symbol).run();
        if (dbChanges(releaseRes) === 0) {
            await env.DB.prepare(
                "UPDATE orders SET status='PENDING', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='CANCELLED'"
            ).bind(id).run();
            return errorResponse('持仓释放失败，已回滚撤单', 500, 5003);
        }
    }

    return jsonResponse({ message: '撤单成功' });
};

export const matchOrders = async (env) => {
    if (!Time.isMarketOpen()) {
        console.log('Market Closed. Skipping match.');
        return;
    }

    const { results: orders } = await env.DB.prepare(
        "SELECT * FROM orders WHERE status='PENDING' ORDER BY id ASC"
    ).all();
    if (orders.length === 0) return;

    const symbols = [...new Set(orders.map((o) => o.symbol))];
    const prices = {};
    for (const s of symbols) {
        const d = await fetchStockPrice(s);
        if (d) prices[s] = Money.toCent(d.price);
    }

    for (const o of orders) {
        const curr = prices[o.symbol];
        if (!curr) continue;

        const isMatch = o.side === 'BUY' ? (o.price >= curr) : (o.price <= curr);
        if (isMatch) {
            await executeTrade(env, o, curr);
        }
    }
};

async function executeTrade(env, order, exePrice) {
    const claimRes = await env.DB.prepare(
        "UPDATE orders SET status='MATCHING', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'"
    ).bind(order.id).run();
    if (dbChanges(claimRes) === 0) return;

    try {
        await withTransaction(env, async () => {
            const freshOrder = await env.DB.prepare(
                "SELECT * FROM orders WHERE id=? AND status='MATCHING'"
            ).bind(order.id).first();
            if (!freshOrder) throw new Error('order not found in matching state');

            const qty = Number(freshOrder.qty);
            if (!isPositiveInteger(qty)) throw new Error('invalid matched qty');

            const tradeAmt = exePrice * qty;
            const fee = Money.calcCommission(tradeAmt);
            const tax = freshOrder.side === 'SELL' ? Money.calcTax(tradeAmt) : 0;
            const totalSettlement = freshOrder.side === 'BUY' ? (tradeAmt + fee) : (tradeAmt - fee - tax);
            if (!Number.isInteger(totalSettlement)) throw new Error('invalid settlement');

            const acc = await env.DB.prepare('SELECT balance FROM account WHERE id = 1').first();
            const { results: allHoldings } = await env.DB.prepare(
                'SELECT symbol, quantity, avg_cost FROM holdings'
            ).all();

            let totalMarketCap = 0;
            let targetOldQty = 0;
            for (const h of allHoldings) {
                if (h.symbol === freshOrder.symbol) targetOldQty = h.quantity;
                totalMarketCap += h.quantity * (h.symbol === freshOrder.symbol ? exePrice : h.avg_cost);
            }

            const totalAssetsBefore = acc.balance + totalMarketCap;
            const prePosRatio = totalAssetsBefore > 0
                ? parseFloat(((targetOldQty * exePrice / totalAssetsBefore) * 100).toFixed(2))
                : 0;
            const newQty = freshOrder.side === 'BUY' ? (targetOldQty + qty) : (targetOldQty - qty);
            const postPosRatio = totalAssetsBefore > 0
                ? parseFloat(((Math.max(newQty, 0) * exePrice / totalAssetsBefore) * 100).toFixed(2))
                : 0;

            if (freshOrder.side === 'BUY') {
                const payRes = await env.DB.prepare(
                    'UPDATE account SET balance = balance - ?, frozen_balance = frozen_balance - ? WHERE id = 1 AND balance >= ? AND frozen_balance >= ?'
                ).bind(totalSettlement, freshOrder.freeze_amount, totalSettlement, freshOrder.freeze_amount).run();
                if (dbChanges(payRes) === 0) throw new Error('account settlement failed for buy order');

                const oldH = await env.DB.prepare(
                    'SELECT total_cost, quantity FROM holdings WHERE symbol = ?'
                ).bind(freshOrder.symbol).first();

                if (oldH) {
                    const nQty = oldH.quantity + qty;
                    const nCost = oldH.total_cost + totalSettlement;
                    const nAvg = Math.round(nCost / nQty);
                    const holdRes = await env.DB.prepare(
                        'UPDATE holdings SET quantity=?, total_cost=?, avg_cost=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=?'
                    ).bind(nQty, nCost, nAvg, freshOrder.symbol).run();
                    if (dbChanges(holdRes) === 0) throw new Error('holdings update failed for buy order');
                } else {
                    await env.DB.prepare(
                        'INSERT INTO holdings (symbol, name, quantity, available_qty, avg_cost, total_cost) VALUES (?, ?, ?, 0, ?, ?)'
                    ).bind(freshOrder.symbol, freshOrder.name, qty, Math.round(totalSettlement / qty), totalSettlement).run();
                }
            } else {
                const hInfo = await env.DB.prepare(
                    'SELECT quantity, available_qty, avg_cost FROM holdings WHERE symbol = ?'
                ).bind(freshOrder.symbol).first();
                if (!hInfo || hInfo.quantity < qty) throw new Error('holdings settlement failed for sell order');

                if (hInfo.quantity > qty) {
                    const nQty = hInfo.quantity - qty;
                    const nCost = Math.round(hInfo.avg_cost * nQty);
                    const nAvailable = Math.min(hInfo.available_qty, nQty);
                    const holdRes = await env.DB.prepare(
                        'UPDATE holdings SET quantity = ?, available_qty = ?, total_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?'
                    ).bind(nQty, nAvailable, nCost, freshOrder.symbol).run();
                    if (dbChanges(holdRes) === 0) throw new Error('holdings update failed for sell order');
                } else {
                    const delRes = await env.DB.prepare(
                        'DELETE FROM holdings WHERE symbol = ?'
                    ).bind(freshOrder.symbol).run();
                    if (dbChanges(delRes) === 0) throw new Error('holdings delete failed for sell order');
                }

                const creditRes = await env.DB.prepare(
                    'UPDATE account SET balance = balance + ? WHERE id = 1'
                ).bind(totalSettlement).run();
                if (dbChanges(creditRes) === 0) throw new Error('account credit failed for sell order');
            }

            const tradeRes = await env.DB.prepare(`
                INSERT INTO trades (order_id, symbol, name, side, price, qty, amount, commission, tax, pre_pos_ratio, post_pos_ratio)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                freshOrder.id,
                freshOrder.symbol,
                freshOrder.name,
                freshOrder.side,
                exePrice,
                qty,
                tradeAmt,
                fee,
                tax,
                prePosRatio,
                postPosRatio
            ).run();
            if (dbChanges(tradeRes) === 0) throw new Error('trade insert failed');

            const fillRes = await env.DB.prepare(
                "UPDATE orders SET status = 'FILLED', filled_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'MATCHING'"
            ).bind(qty, freshOrder.id).run();
            if (dbChanges(fillRes) === 0) throw new Error('order final status update failed');
        });
    } catch (e) {
        console.error('executeTrade error', order?.id, e);
        await env.DB.prepare(
            "UPDATE orders SET status='ERROR', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='MATCHING'"
        ).bind(order.id).run();
    }
}

