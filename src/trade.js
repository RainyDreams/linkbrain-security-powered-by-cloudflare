import { jsonResponse, errorResponse, Money, Time, TradeRules } from './utils.js';
import { fetchStockPrice } from './market.js';
import { withTransaction } from './db.js';
import { logBizError, logError, logFinancialAudit } from './audit.js';

const ORDER_SIDES = new Set(['BUY', 'SELL']);
const STRATEGY_TAG_ALIAS = Object.freeze({
    LONG_STABLE: 'LONG_STABLE',
    SHORT_AGGRESSIVE: 'SHORT_AGGRESSIVE',
    MID_BALANCED: 'MID_BALANCED',
    STABLE_LONG: 'LONG_STABLE',
    AGGRESSIVE_SHORT: 'SHORT_AGGRESSIVE'
});
const STRATEGY_TAG_ALLOW = new Set(['LONG_STABLE', 'SHORT_AGGRESSIVE', 'MID_BALANCED']);

const dbChanges = (result) => result?.meta?.changes ?? 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const sanitizeRemark = (value, maxLen = 1200) => String(value || '').trim().slice(0, maxLen);
const normalizeStrategyTag = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    const alias = STRATEGY_TAG_ALIAS[raw] || STRATEGY_TAG_ALIAS[upper] || upper;
    return STRATEGY_TAG_ALLOW.has(alias) ? alias : sanitizeRemark(raw, 40).toUpperCase();
};

const getAccountSnapshot = async (env) => {
    const row = await env.DB.prepare('SELECT balance, frozen_balance FROM account WHERE id=1').first();
    return {
        balance: Number(row?.balance || 0),
        frozen_balance: Number(row?.frozen_balance || 0)
    };
};

const getHoldingSnapshot = async (env, symbol) => {
    const row = await env.DB.prepare(
        'SELECT quantity, available_qty FROM holdings WHERE symbol=?'
    ).bind(symbol).first();
    return {
        quantity: Number(row?.quantity || 0),
        available_qty: Number(row?.available_qty || 0)
    };
};

const auditReject = async (env, msg, code, status = 400, meta = {}, scope = 'trade') => {
    await logBizError(env, {
        status,
        scope,
        message: msg,
        category: 'business',
        subcategory: scope,
        meta: { code, ...meta }
    });
    return errorResponse(msg, status, code);
};

const stripMarketPrefix = (symbol) => String(symbol || '').toLowerCase().replace(/^(sh|sz|bj)/, '');

const detectBoard = (fullSymbol) => {
    const symbol = String(fullSymbol || '').toLowerCase();
    const code = stripMarketPrefix(symbol);
    if (symbol.startsWith('bj') || code.startsWith('8') || code.startsWith('4')) return 'BSE';
    if (code.startsWith('688')) return 'STAR';
    if (code.startsWith('300')) return 'CHINEXT';
    if (code.startsWith('60') || code.startsWith('00')) return 'MAIN';
    if (symbol.startsWith('sh') || symbol.startsWith('sz')) return 'MAIN';
    return 'OTHER';
};

const getLimitPct = (fullSymbol) => {
    const board = detectBoard(fullSymbol);
    if (board === 'CHINEXT' || board === 'STAR') return 0.2;
    if (board === 'BSE') return 0.3;
    return 0.1;
};

const getPriceCageRule = (fullSymbol) => {
    const board = detectBoard(fullSymbol);
    if (board === 'STAR') {
        return { board, enabled: true, pct: 0.02, absOffsetCent: 0, mode: 'REJECT' };
    }
    if (board === 'BSE') {
        return { board, enabled: true, pct: 0.05, absOffsetCent: 10, mode: 'QUEUE' };
    }
    if (board === 'MAIN' || board === 'CHINEXT') {
        return { board, enabled: true, pct: 0.02, absOffsetCent: 10, mode: 'REJECT' };
    }
    return { board, enabled: false, pct: 0, absOffsetCent: 0, mode: 'NONE' };
};

const buildPriceCage = (referenceCent, rule) => {
    const buyPctUpper = Math.floor(referenceCent * (1 + rule.pct));
    const sellPctLower = Math.ceil(referenceCent * (1 - rule.pct));

    const buyUpper = rule.absOffsetCent > 0
        ? Math.max(buyPctUpper, referenceCent + rule.absOffsetCent)
        : buyPctUpper;
    const sellLower = rule.absOffsetCent > 0
        ? Math.min(sellPctLower, Math.max(1, referenceCent - rule.absOffsetCent))
        : sellPctLower;

    return {
        buy_upper: Math.max(1, buyUpper),
        sell_lower: Math.max(1, sellLower)
    };
};

const isCageViolated = (side, priceCent, cage) => {
    if (!cage?.enabled || !cage?.applicable) return false;
    if (side === 'BUY') return priceCent > Number(cage.buy_upper || 0);
    if (side === 'SELL') return priceCent < Number(cage.sell_lower || 0);
    return false;
};

export const getPriceAssist = (fullSymbol, lastPriceCent, prevCloseCent, options = {}) => {
    const validPrevClose = Number.isInteger(prevCloseCent) && prevCloseCent > 0 ? prevCloseCent : 0;
    const validLastPrice = Number.isInteger(lastPriceCent) && lastPriceCent > 0 ? lastPriceCent : 0;
    const limitReferenceCent = validPrevClose || validLastPrice;
    const cageReferenceCent = validLastPrice || limitReferenceCent;

    if (!limitReferenceCent) {
        return {
            reference_cent: 0,
            limit_reference_cent: 0,
            cage_reference_cent: 0,
            limit: null,
            cage: null,
            board: detectBoard(fullSymbol),
            suggest: null
        };
    }

    const limitPct = getLimitPct(fullSymbol);
    const limitDown = Math.max(1, Math.floor(limitReferenceCent * (1 - limitPct)));
    const limitUp = Math.ceil(limitReferenceCent * (1 + limitPct));

    const rule = getPriceCageRule(fullSymbol);
    const hasCage = rule.enabled;
    const continuousAuction = options.apply_cage ?? Time.isContinuousAuction();
    const cageReason = continuousAuction ? '' : 'not in continuous auction session';

    const builtCage = hasCage
        ? buildPriceCage(cageReferenceCent, rule)
        : { buy_upper: limitUp, sell_lower: limitDown };

    const boundedCageUpper = Math.max(1, Math.min(limitUp, Number(builtCage.buy_upper || limitUp)));
    const boundedCageLower = Math.max(1, Math.max(limitDown, Number(builtCage.sell_lower || limitDown)));
    const cageUpper = Math.max(boundedCageUpper, boundedCageLower);
    const cageLower = Math.min(boundedCageLower, cageUpper);

    const baseline = validLastPrice || cageReferenceCent;
    const buy = Math.min(cageUpper, Math.max(cageLower, baseline + 1));
    const sell = Math.max(cageLower, Math.min(cageUpper, baseline - 1));
    const mid = Math.round((cageUpper + cageLower) / 2);

    return {
        board: rule.board,
        reference_cent: limitReferenceCent,
        limit_reference_cent: limitReferenceCent,
        cage_reference_cent: cageReferenceCent,
        limit: {
            pct: limitPct,
            low: limitDown,
            high: limitUp
        },
        cage: {
            enabled: hasCage,
            applicable: hasCage ? continuousAuction : false,
            mode: rule.mode,
            pct: rule.pct,
            abs_offset_cent: rule.absOffsetCent,
            sell_lower: cageLower,
            buy_upper: cageUpper,
            low: cageLower,
            high: cageUpper,
            reason: hasCage ? cageReason : 'no cage rule for this board'
        },
        suggest: {
            buy,
            sell,
            mid
        }
    };
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
    const remark = sanitizeRemark(body?.remark || body?.note || body?.memo, 1200);
    const strategyTag = normalizeStrategyTag(body?.strategy_tag || body?.strategy || body?.style);
    if (!symbol || !/^(sh|sz|bj)\d{6}$/.test(symbol)) return { ok: false, message: 'symbol 非法' };

    const referenceCent = Money.toCent(marketData.prevClose || marketData.price);
    const assist = getPriceAssist(symbol, Money.toCent(marketData.price), referenceCent, {
        apply_cage: Time.isContinuousAuction()
    });
    if (assist.limit) {
        if (priceCent < assist.limit.low || priceCent > assist.limit.high) {
            return { ok: false, message: '委托价超出涨跌停价格区间' };
        }

        const cageViolated = isCageViolated(side, priceCent, assist.cage);
        if (cageViolated && assist.cage?.mode === 'REJECT') {
            return { ok: false, message: '委托价超出价格笼子区间' };
        }

        return {
            ok: true,
            side,
            qty,
            priceCent,
            symbol,
            name: marketData.name,
            board: assist.board,
            cage: assist.cage,
            cageViolated,
            remark,
            strategy_tag: strategyTag
        };
    }

    return {
        ok: true,
        side,
        qty,
        priceCent,
        symbol,
        name: marketData.name,
        board: assist.board,
        cage: assist.cage,
        cageViolated: false,
        remark,
        strategy_tag: strategyTag
    };
};

export const placeOrder = async (env, body) => {
    const symbolInput = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
    if (!symbolInput) return await auditReject(env, 'symbol 不能为空', 4007, 400, {}, 'trade.place');

    const marketData = await fetchStockPrice(symbolInput);
    if (!marketData) {
        await logBizError(env, {
            status: 400,
            scope: 'trade.market',
            category: 'market',
            subcategory: 'missing_quote',
            message: '行情不可用，可能停牌/退市/无报价',
            meta: { symbol: symbolInput }
        });
        return await auditReject(env, '无法获取行情（可能停牌或退市）', 4005, 400, { symbol: symbolInput }, 'trade.place');
    }

    const validated = validateOrderInput(body, marketData);
    if (!validated.ok) {
        return await auditReject(env, validated.message, 4008, 400, { symbol: symbolInput }, 'trade.place');
    }

    const { symbol, name, side, qty, priceCent, board, cage, cageViolated, remark, strategy_tag } = validated;
    const queuedByCage = !!(cageViolated && cage?.mode === 'QUEUE');
    const totalAmt = priceCent * qty;
    if (!isPositiveInteger(totalAmt)) {
        return await auditReject(env, '委托金额非法', 4009, 400, { symbol, qty, price_cent: priceCent }, 'trade.place');
    }

    try {
        return await withTransaction(env, async () => {
            const accountBefore = await getAccountSnapshot(env);
            const holdingBefore = await getHoldingSnapshot(env, symbol);
            let createdOrderId = null;

            if (side === 'BUY') {
                const fee = Money.calcCommission(totalAmt);
                const freeze = totalAmt + fee;

                const freezeRes = await env.DB.prepare(
                    'UPDATE account SET frozen_balance = frozen_balance + ? WHERE id=1 AND (balance - frozen_balance) >= ?'
                ).bind(freeze, freeze).run();
                if (dbChanges(freezeRes) === 0) {
                    await logFinancialAudit(env, {
                        event_type: 'ORDER_PLACE',
                        scope: 'trade.place',
                        category: 'order',
                        subcategory: 'BUY',
                        tags: ['order', 'place', 'buy'],
                        status: 'FAILED',
                        symbol,
                        side,
                        qty,
                        price: priceCent,
                        amount: totalAmt,
                        fee,
                        tax: 0,
                        freeze_before: accountBefore.frozen_balance,
                        freeze_after: accountBefore.frozen_balance,
                        balance_before: accountBefore.balance,
                        balance_after: accountBefore.balance,
                        holdings_before: holdingBefore.quantity,
                        holdings_after: holdingBefore.quantity,
                        available_before: holdingBefore.available_qty,
                        available_after: holdingBefore.available_qty,
                        message: 'place buy order failed: insufficient available balance'
                    });
                    return await auditReject(
                        env,
                        '可用资金不足',
                        4001,
                        400,
                        { symbol, qty, price_cent: priceCent, freeze_amount: freeze },
                        'trade.place'
                    );
                }

                const insertRes = await env.DB.prepare(
                    "INSERT INTO orders (symbol, name, side, price, qty, freeze_amount, status, remark, strategy_tag) VALUES (?, ?, 'BUY', ?, ?, ?, 'PENDING', ?, ?)"
                ).bind(symbol, name, priceCent, qty, freeze, remark, strategy_tag).run();
                if (dbChanges(insertRes) === 0) throw new Error('order insert failed');

                const accountAfter = await getAccountSnapshot(env);
                const orderId = Number(insertRes?.meta?.last_row_id || 0) || null;
                createdOrderId = orderId;
                await logFinancialAudit(env, {
                    event_type: 'ORDER_PLACE',
                    scope: 'trade.place',
                    category: 'order',
                    subcategory: 'BUY',
                    tags: ['order', 'place', 'buy'],
                    status: 'SUCCESS',
                    order_id: orderId,
                    symbol,
                    side,
                    qty,
                    price: priceCent,
                    amount: totalAmt,
                    fee,
                    tax: 0,
                    freeze_before: accountBefore.frozen_balance,
                    freeze_after: accountAfter.frozen_balance,
                    balance_before: accountBefore.balance,
                    balance_after: accountAfter.balance,
                    holdings_before: holdingBefore.quantity,
                    holdings_after: holdingBefore.quantity,
                    available_before: holdingBefore.available_qty,
                    available_after: holdingBefore.available_qty,
                    message: 'place buy order success'
                });
            } else {
                const holdRes = await env.DB.prepare(
                    'UPDATE holdings SET available_qty = available_qty - ? WHERE symbol=? AND available_qty >= ? AND quantity >= ?'
                ).bind(qty, symbol, qty, qty).run();
                if (dbChanges(holdRes) === 0) {
                    await logFinancialAudit(env, {
                        event_type: 'ORDER_PLACE',
                        scope: 'trade.place',
                        category: 'order',
                        subcategory: 'SELL',
                        tags: ['order', 'place', 'sell'],
                        status: 'FAILED',
                        symbol,
                        side,
                        qty,
                        price: priceCent,
                        amount: totalAmt,
                        fee: 0,
                        tax: 0,
                        freeze_before: accountBefore.frozen_balance,
                        freeze_after: accountBefore.frozen_balance,
                        balance_before: accountBefore.balance,
                        balance_after: accountBefore.balance,
                        holdings_before: holdingBefore.quantity,
                        holdings_after: holdingBefore.quantity,
                        available_before: holdingBefore.available_qty,
                        available_after: holdingBefore.available_qty,
                        message: 'place sell order failed: insufficient available holdings'
                    });
                    return await auditReject(env, '可用持仓不足', 4002, 400, { symbol, qty }, 'trade.place');
                }

                const insertRes = await env.DB.prepare(
                    "INSERT INTO orders (symbol, name, side, price, qty, status, remark, strategy_tag) VALUES (?, ?, 'SELL', ?, ?, 'PENDING', ?, ?)"
                ).bind(symbol, name, priceCent, qty, remark, strategy_tag).run();
                if (dbChanges(insertRes) === 0) throw new Error('order insert failed');

                const holdingAfter = await getHoldingSnapshot(env, symbol);
                const orderId = Number(insertRes?.meta?.last_row_id || 0) || null;
                createdOrderId = orderId;
                await logFinancialAudit(env, {
                    event_type: 'ORDER_PLACE',
                    scope: 'trade.place',
                    category: 'order',
                    subcategory: 'SELL',
                    tags: ['order', 'place', 'sell'],
                    status: 'SUCCESS',
                    order_id: orderId,
                    symbol,
                    side,
                    qty,
                    price: priceCent,
                    amount: totalAmt,
                    fee: 0,
                    tax: 0,
                    freeze_before: accountBefore.frozen_balance,
                    freeze_after: accountBefore.frozen_balance,
                    balance_before: accountBefore.balance,
                    balance_after: accountBefore.balance,
                    holdings_before: holdingBefore.quantity,
                    holdings_after: holdingAfter.quantity,
                    available_before: holdingBefore.available_qty,
                    available_after: holdingAfter.available_qty,
                    message: 'place sell order success'
                });
            }

            return jsonResponse({
                message: queuedByCage ? '委托已暂存，待价格回落至笼子区间后再撮合' : '委托已提交',
                board,
                cage_queued: queuedByCage,
                status: 'PENDING',
                order_id: createdOrderId
            });
        });
    } catch (e) {
        await logFinancialAudit(env, {
            event_type: 'ORDER_PLACE',
            scope: 'trade.place',
            category: 'order',
            subcategory: side,
            tags: ['order', 'place'],
            status: 'FAILED',
            symbol,
            side,
            qty,
            price: priceCent,
            amount: totalAmt,
            message: 'place order internal error',
            error_stack: e?.stack || ''
        });
        await logError(env, e, { symbol, side, qty, price_cent: priceCent }, 'trade.place');
        return errorResponse('委托提交失败，请稍后重试', 500, 5001);
    }
};

export const cancelOrder = async (env, orderId) => {
    const id = Number(orderId);
    if (!isPositiveInteger(id)) return await auditReject(env, 'order_id 非法', 4010, 400, { order_id: orderId }, 'order.cancel');

    try {
        return await withTransaction(env, async () => {
            const order = await env.DB.prepare(
                "SELECT id, side, qty, symbol, freeze_amount FROM orders WHERE id=? AND status='PENDING'"
            ).bind(id).first();
            if (!order) return await auditReject(env, '订单不可撤销', 4003, 400, { order_id: id }, 'order.cancel');

            const accountBefore = await getAccountSnapshot(env);
            const holdingBefore = await getHoldingSnapshot(env, order.symbol);

            const cancelRes = await env.DB.prepare(
                "UPDATE orders SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'"
            ).bind(id).run();
            if (dbChanges(cancelRes) === 0) {
                return await auditReject(env, '订单不可撤销', 4003, 400, { order_id: id }, 'order.cancel');
            }

            if (order.side === 'BUY') {
                const releaseRes = await env.DB.prepare(
                    'UPDATE account SET frozen_balance = frozen_balance - ? WHERE id=1 AND frozen_balance >= ?'
                ).bind(order.freeze_amount, order.freeze_amount).run();
                if (dbChanges(releaseRes) === 0) {
                    throw new Error('failed to release frozen balance on cancel');
                }
            } else {
                const releaseRes = await env.DB.prepare(
                    'UPDATE holdings SET available_qty = MIN(quantity, available_qty + ?) WHERE symbol=?'
                ).bind(order.qty, order.symbol).run();
                if (dbChanges(releaseRes) === 0) {
                    throw new Error('failed to release holdings on cancel');
                }
            }

            const accountAfter = await getAccountSnapshot(env);
            const holdingAfter = await getHoldingSnapshot(env, order.symbol);
            await logFinancialAudit(env, {
                event_type: 'ORDER_CANCEL',
                scope: 'order.cancel',
                category: 'order',
                subcategory: order.side,
                tags: ['order', 'cancel'],
                status: 'SUCCESS',
                order_id: id,
                symbol: order.symbol,
                side: order.side,
                qty: order.qty,
                amount: order.freeze_amount || 0,
                fee: 0,
                tax: 0,
                freeze_before: accountBefore.frozen_balance,
                freeze_after: accountAfter.frozen_balance,
                balance_before: accountBefore.balance,
                balance_after: accountAfter.balance,
                holdings_before: holdingBefore.quantity,
                holdings_after: holdingAfter.quantity,
                available_before: holdingBefore.available_qty,
                available_after: holdingAfter.available_qty,
                message: 'order cancel success'
            });

            return jsonResponse({ message: '撤单成功' });
        });
    } catch (e) {
        await logFinancialAudit(env, {
            event_type: 'ORDER_CANCEL',
            scope: 'order.cancel',
            category: 'order',
            subcategory: 'CANCEL',
            tags: ['order', 'cancel'],
            status: 'FAILED',
            order_id: id,
            message: 'order cancel internal error',
            error_stack: e?.stack || ''
        });
        await logError(env, e, { order_id: id }, 'order.cancel');
        return errorResponse('撤单失败，请稍后重试', 500, 5004);
    }
};

export const matchOrders = async (env, options = {}) => {
    const force = options?.force === true;
    if (!force && !Time.isContinuousAuction()) {
        console.log('Non-continuous auction session. Skipping match.');
        return { skipped: true, reason: 'non_continuous_auction', checked: 0, triggered: 0 };
    }

    const { results: orders } = await env.DB.prepare(
        "SELECT * FROM orders WHERE status='PENDING' ORDER BY id ASC"
    ).all();
    if (orders.length === 0) return { skipped: false, checked: 0, triggered: 0 };

    const symbols = [...new Set(orders.map((o) => o.symbol))];
    const quotes = {};
    for (const s of symbols) {
        const d = await fetchStockPrice(s);
        if (d) {
            quotes[s] = d;
        } else {
            await logBizError(env, {
                level: 'WARN',
                status: 409,
                scope: 'trade.market',
                category: 'market',
                subcategory: 'missing_quote',
                message: 'symbol quote missing during match, likely halted/delisted/no feed',
                meta: { symbol: s }
            });
        }
    }

    let triggered = 0;
    for (const o of orders) {
        const q = quotes[o.symbol];
        if (!q) continue;

        const curr = Money.toCent(q.price);
        const prevCloseCent = Money.toCent(q.prevClose || q.price);
        const assist = getPriceAssist(o.symbol, curr, prevCloseCent, {
            apply_cage: Time.isContinuousAuction()
        });
        if (isCageViolated(o.side, Number(o.price || 0), assist.cage)) {
            // 北交所超限单暂存；其余板块理论上已在下单阶段拦截。
            continue;
        }

        const isMatch = o.side === 'BUY' ? (o.price >= curr) : (o.price <= curr);
        if (isMatch) {
            triggered += 1;
            await executeTrade(env, o, curr);
        }
    }

    return { skipped: false, checked: orders.length, triggered, forced: force };
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

            const acc = await env.DB.prepare('SELECT balance, frozen_balance FROM account WHERE id = 1').first();
            const accountBefore = {
                balance: Number(acc?.balance || 0),
                frozen_balance: Number(acc?.frozen_balance || 0)
            };
            const holdingBefore = await getHoldingSnapshot(env, freshOrder.symbol);
            const { results: allHoldings } = await env.DB.prepare(
                'SELECT symbol, quantity, avg_cost FROM holdings'
            ).all();

            let totalMarketCap = 0;
            let targetOldQty = 0;
            for (const h of allHoldings) {
                if (h.symbol === freshOrder.symbol) targetOldQty = Number(h.quantity || 0);
                totalMarketCap += Number(h.quantity || 0) * (h.symbol === freshOrder.symbol ? exePrice : Number(h.avg_cost || 0));
            }

            const totalAssetsBefore = accountBefore.balance + totalMarketCap;
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
                    const nQty = Number(oldH.quantity || 0) + qty;
                    const nCost = Number(oldH.total_cost || 0) + totalSettlement;
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
                if (!hInfo || Number(hInfo.quantity || 0) < qty) throw new Error('holdings settlement failed for sell order');

                if (Number(hInfo.quantity || 0) > qty) {
                    const nQty = Number(hInfo.quantity || 0) - qty;
                    const nCost = Math.round(Number(hInfo.avg_cost || 0) * nQty);
                    const nAvailable = Math.min(Number(hInfo.available_qty || 0), nQty);
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

            const accountAfter = await getAccountSnapshot(env);
            const holdingAfter = await getHoldingSnapshot(env, freshOrder.symbol);
            await logFinancialAudit(env, {
                event_type: 'TRADE_EXECUTE',
                scope: 'trade.execute',
                category: 'trade',
                subcategory: freshOrder.side,
                tags: ['trade', 'execute', String(freshOrder.side).toLowerCase()],
                status: 'SUCCESS',
                order_id: freshOrder.id,
                symbol: freshOrder.symbol,
                side: freshOrder.side,
                qty,
                price: exePrice,
                amount: tradeAmt,
                fee,
                tax,
                freeze_before: accountBefore.frozen_balance,
                freeze_after: accountAfter.frozen_balance,
                balance_before: accountBefore.balance,
                balance_after: accountAfter.balance,
                holdings_before: holdingBefore.quantity,
                holdings_after: holdingAfter.quantity,
                available_before: holdingBefore.available_qty,
                available_after: holdingAfter.available_qty,
                message: 'trade execute success',
                meta: {
                    trade_id: Number(tradeRes?.meta?.last_row_id || 0) || null,
                    settlement: totalSettlement,
                    pre_pos_ratio: prePosRatio,
                    post_pos_ratio: postPosRatio
                }
            });
        });
    } catch (e) {
        console.error('executeTrade error', order?.id, e);
        await env.DB.prepare(
            "UPDATE orders SET status='ERROR', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='MATCHING'"
        ).bind(order.id).run();
        await releaseFailedOrder(env, order?.id);
        await logFinancialAudit(env, {
            event_type: 'TRADE_EXECUTE',
            scope: 'trade.execute',
            category: 'trade',
            subcategory: order?.side || '',
            tags: ['trade', 'execute'],
            status: 'FAILED',
            order_id: order?.id,
            symbol: order?.symbol,
            side: order?.side,
            qty: order?.qty,
            price: exePrice,
            message: 'trade execute failed',
            error_stack: e?.stack || ''
        });
        await logError(env, e, {
            order_id: order?.id,
            symbol: order?.symbol,
            side: order?.side
        }, 'trade.execute');
    }
}

async function releaseFailedOrder(env, orderId) {
    try {
        const id = Number(orderId);
        if (!isPositiveInteger(id)) return;

        const failed = await env.DB.prepare(
            'SELECT id, side, qty, symbol, freeze_amount, status FROM orders WHERE id=?'
        ).bind(id).first();
        if (!failed || failed.status !== 'ERROR') return;

        const accountBefore = await getAccountSnapshot(env);
        const holdingBefore = await getHoldingSnapshot(env, failed.symbol);

        if (failed.side === 'BUY') {
            const releaseRes = await env.DB.prepare(
                'UPDATE account SET frozen_balance = frozen_balance - ? WHERE id=1 AND frozen_balance >= ?'
            ).bind(failed.freeze_amount, failed.freeze_amount).run();
            if (dbChanges(releaseRes) === 0) {
                await logError(env, new Error('failed to release frozen balance for error order'), {
                    order_id: failed.id,
                    freeze_amount: failed.freeze_amount
                }, 'trade.release');
                return;
            }
            const accountAfter = await getAccountSnapshot(env);
            await logFinancialAudit(env, {
                event_type: 'ORDER_RELEASE',
                scope: 'trade.release',
                category: 'order',
                subcategory: 'BUY',
                tags: ['order', 'release', 'buy'],
                status: 'SUCCESS',
                order_id: failed.id,
                symbol: failed.symbol,
                side: failed.side,
                qty: failed.qty,
                amount: failed.freeze_amount,
                freeze_before: accountBefore.frozen_balance,
                freeze_after: accountAfter.frozen_balance,
                balance_before: accountBefore.balance,
                balance_after: accountAfter.balance,
                holdings_before: holdingBefore.quantity,
                holdings_after: holdingBefore.quantity,
                available_before: holdingBefore.available_qty,
                available_after: holdingBefore.available_qty,
                message: 'release frozen balance for failed buy order'
            });
            return;
        }

        const releaseRes = await env.DB.prepare(
            'UPDATE holdings SET available_qty = MIN(quantity, available_qty + ?) WHERE symbol=?'
        ).bind(failed.qty, failed.symbol).run();
        if (dbChanges(releaseRes) === 0) {
            await logError(env, new Error('failed to release available quantity for error order'), {
                order_id: failed.id,
                symbol: failed.symbol,
                qty: failed.qty
            }, 'trade.release');
            return;
        }

        const holdingAfter = await getHoldingSnapshot(env, failed.symbol);
        await logFinancialAudit(env, {
            event_type: 'ORDER_RELEASE',
            scope: 'trade.release',
            category: 'order',
            subcategory: 'SELL',
            tags: ['order', 'release', 'sell'],
            status: 'SUCCESS',
            order_id: failed.id,
            symbol: failed.symbol,
            side: failed.side,
            qty: failed.qty,
            freeze_before: accountBefore.frozen_balance,
            freeze_after: accountBefore.frozen_balance,
            balance_before: accountBefore.balance,
            balance_after: accountBefore.balance,
            holdings_before: holdingBefore.quantity,
            holdings_after: holdingAfter.quantity,
            available_before: holdingBefore.available_qty,
            available_after: holdingAfter.available_qty,
            message: 'release available quantity for failed sell order'
        });
    } catch (e) {
        await logError(env, e, { order_id: orderId }, 'trade.release');
    }
}


